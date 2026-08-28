import { fromArrayBuffer } from 'geotiff';
import type { Env } from '../config/env';
import type { AppLogger } from '../logger';
import type { Grid } from './grid';
import { colorizeRadarGrid, decodeRadarHdf5, downsampleRadarGrid, type RadarCorners } from './radar';

export interface RadarMosaic {
  fetchedAt: string;
  validTime: string;
  corners: RadarCorners;
  imageBase64: string;
}

export interface HourlyForecastEntry {
  time: string;
  temperatureC: number;
  precipitationProbability: number;
  rainMm: number;
  windKmh: number;
}

export type ForecastParam = 'TEMPERATURE' | 'PRECIPITATION' | 'WIND_SPEED';

export interface ForecastGrid extends Grid {
  param: ForecastParam;
  hourOffset: number;
  validTime: string;
}

export interface Vigilance {
  fetchedAt: string;
  departement: string;
  color: 'vert' | 'jaune' | 'orange' | 'rouge';
  risks: string[];
}

export interface MeteoFranceClient {
  getRadarMosaic(): Promise<RadarMosaic>;
  getForecastGrid(param: ForecastParam, hourOffset: number): Promise<ForecastGrid>;
  getVigilanceMap(): Promise<Record<string, Vigilance>>;
}

export class MeteoFranceApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MeteoFranceApiError';
  }
}

// Chemins confirmes en conditions reelles le 2026-08-28 (API "DonneesPubliquesRadar"). Le
// produit renvoie le fichier HDF5 (ODIM_H5) le plus recent pour la zone/observation demandee,
// a la maille 500m (la variante maille=1000 renvoie du BUFR, non exploitable en JS/WASM).
const ENDPOINTS = {
  radarProduit: (zone: string, observation: string) =>
    `/public/DPRadar/v1/mosaiques/${zone}/observations/${observation}/produit`,
  vigilanceCarte: '/public/DPVigilance/v1/cartevigilance/encours',
  aromeWcs: '/public/arome/1.0/wcs/MF-NWP-HIGHRES-AROME-001-FRANCE-WCS/GetCoverage',
} as const;

const RADAR_ZONE = 'METROPOLE';
// LAME_D_EAU (cumul de pluie, quantite ACRR) uniquement pour l'instant : REFLECTIVITE ne
// supporte pas la maille 500m (verifie en conditions reelles, l'API renvoie 400 "la maille
// '500' n'existe pas") et sa seule maille disponible (1000m) est en BUFR, non decodable.
const RADAR_OBSERVATION = 'LAME_D_EAU';
const RADAR_MESH_METERS = 500;

// Taille max (en pixels, plus grand cote) de l'image radar rendue : la grille source
// (3472x3472, ~12M pixels) est inutilement lourde pour un affichage carte.
const RADAR_MAX_IMAGE_DIMENSION = 1200;

// TODO: noms de coverage exacts a confirmer (dependent de la nomenclature WCS AROME reelle,
// visible uniquement dans le GetCapabilities authentifie). Prefixes vraisemblables d'apres
// la convention de nommage Meteo-France (parametre + niveau).
const AROME_COVERAGE_PREFIX: Record<ForecastParam, string> = {
  TEMPERATURE: 'TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___2_M',
  PRECIPITATION: 'TOTAL_PRECIPITATION__GROUND_OR_WATER_SURFACE',
  WIND_SPEED: 'WIND_SPEED__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___10_M',
};

// Domaine restreint (plutot que la France entiere en pleine resolution 1.3km) pour garder
// des grilles legeres a decoder/stocker : suffisant pour interpoler un point metropolitain.
const AROME_BBOX = { west: -5.5, south: 41, east: 10, north: 51.5 } as const;

// Taille max de grille conservee apres decodage (sous-echantillonnage si la grille source
// est plus fine) : limite la taille des entrees Redis independamment de la resolution AROME.
const MAX_GRID_DIMENSION = 120;

function buildValidTime(hourOffset: number): string {
  const runHour = new Date();
  runHour.setUTCMinutes(0, 0, 0);
  const validTime = new Date(runHour.getTime() + hourOffset * 60 * 60 * 1000);
  return validTime.toISOString();
}

// Isole pour etre testable independamment d'un appel reseau reel.
export function buildAromeCoverageId(param: ForecastParam, validTime: string): string {
  // TODO: format de suffixe temporel exact (separateurs "." vs ":") a confirmer.
  const suffix = validTime.replace(/:/g, '.');
  return `${AROME_COVERAGE_PREFIX[param]}___${suffix}`;
}

export function buildAromeGetCoverageUrl(
  baseUrl: string,
  param: ForecastParam,
  hourOffset: number,
): { url: URL; validTime: string; coverageId: string } {
  const validTime = buildValidTime(hourOffset);
  const coverageId = buildAromeCoverageId(param, validTime);
  const url = new URL(ENDPOINTS.aromeWcs, baseUrl);
  url.searchParams.set('service', 'WCS');
  url.searchParams.set('version', '2.0.1');
  url.searchParams.set('coverageId', coverageId);
  url.searchParams.set('format', 'image/tiff');
  url.searchParams.set('subset', `Long(${AROME_BBOX.west},${AROME_BBOX.east})`);
  url.searchParams.append('subset', `Lat(${AROME_BBOX.south},${AROME_BBOX.north})`);
  return { url, validTime, coverageId };
}

// Isole pour etre testable independamment d'un appel reseau reel.
export function buildRadarProduitUrl(baseUrl: string): URL {
  const url = new URL(ENDPOINTS.radarProduit(RADAR_ZONE, RADAR_OBSERVATION), baseUrl);
  url.searchParams.set('maille', String(RADAR_MESH_METERS));
  return url;
}

function downsampleStride(width: number, height: number): number {
  return Math.max(1, Math.ceil(Math.max(width, height) / MAX_GRID_DIMENSION));
}

interface RawVigilanceDomainEntry {
  domain_id: string;
  max_color_id: number;
  phenomenon_items?: Array<{ phenomenon_id: string; phenomenon_max_color_id: number }>;
}

interface RawVigilanceCarte {
  product?: {
    periods?: Array<{
      echeance?: string;
      timelaps?: { domain_ids?: RawVigilanceDomainEntry[] };
    }>;
  };
}

const VIGILANCE_COLOR_BY_ID: Record<string, Vigilance['color']> = {
  '1': 'vert',
  '2': 'jaune',
  '3': 'orange',
  '4': 'rouge',
};

const VIGILANCE_PHENOMENON_LABELS: Record<string, string> = {
  '1': 'vent',
  '2': 'pluie-inondation',
  '3': 'orages',
  '4': 'crues',
  '5': 'neige-verglas',
  '6': 'canicule',
  '7': 'grand-froid',
  '8': 'avalanches',
  '9': 'vagues-submersion',
};

// Forme confirmee avec un vrai payload (compte SeaFly, 2026-08-28) : la reponse est enveloppee
// dans "product", les couleurs sont des nombres (pas des chaines), et la liste de phenomenes
// par domaine s'appelle "phenomenon_items". domain_id couvre les departements metropole/DOM
// (ce qui nous interesse), des zones maritimes (4 chiffres) et "FRA" (national) qu'on ignore.
export function parseVigilanceCarte(raw: unknown, fetchedAt: string): Record<string, Vigilance> {
  const carte = raw as RawVigilanceCarte;
  const periods = carte.product?.periods;
  const currentPeriod = periods?.find((p) => p.echeance === 'J') ?? periods?.[0];
  const domains = currentPeriod?.timelaps?.domain_ids ?? [];

  const result: Record<string, Vigilance> = {};
  for (const domain of domains) {
    const color = VIGILANCE_COLOR_BY_ID[String(domain.max_color_id)] ?? 'vert';
    const risks = (domain.phenomenon_items ?? [])
      .filter((p) => (VIGILANCE_COLOR_BY_ID[String(p.phenomenon_max_color_id)] ?? 'vert') !== 'vert')
      .map((p) => VIGILANCE_PHENOMENON_LABELS[p.phenomenon_id])
      .filter((label): label is string => Boolean(label));

    result[domain.domain_id] = {
      fetchedAt,
      departement: domain.domain_id,
      color,
      risks,
    };
  }
  return result;
}

export class HttpMeteoFranceClient implements MeteoFranceClient {
  constructor(private readonly env: Env, private readonly logger: AppLogger) {}

  async getRadarMosaic(): Promise<RadarMosaic> {
    const url = buildRadarProduitUrl(this.env.METEOFRANCE_BASE_URL);
    const buffer = await this.requestBuffer(url);

    const grid = downsampleRadarGrid(await decodeRadarHdf5(buffer), RADAR_MAX_IMAGE_DIMENSION);
    const png = colorizeRadarGrid(grid);

    return {
      fetchedAt: new Date().toISOString(),
      validTime: grid.validTime,
      corners: grid.corners,
      imageBase64: png.toString('base64'),
    };
  }

  async getForecastGrid(param: ForecastParam, hourOffset: number): Promise<ForecastGrid> {
    const { url, validTime } = buildAromeGetCoverageUrl(this.env.METEOFRANCE_BASE_URL, param, hourOffset);
    const buffer = await this.requestBuffer(url);

    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const sourceWidth = image.getWidth();
    const sourceHeight = image.getHeight();
    const raster = rasters[0] as ArrayLike<number>;

    const stride = downsampleStride(sourceWidth, sourceHeight);
    const width = Math.ceil(sourceWidth / stride);
    const height = Math.ceil(sourceHeight / stride);
    const values = new Array<number>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        values[y * width + x] = raster[y * stride * sourceWidth + x * stride];
      }
    }

    return {
      param,
      hourOffset,
      validTime,
      west: AROME_BBOX.west,
      south: AROME_BBOX.south,
      east: AROME_BBOX.east,
      north: AROME_BBOX.north,
      width,
      height,
      values,
    };
  }

  async getVigilanceMap(): Promise<Record<string, Vigilance>> {
    const data = await this.requestJson<unknown>(ENDPOINTS.vigilanceCarte);
    return parseVigilanceCarte(data, new Date().toISOString());
  }

  private async requestJson<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.env.METEOFRANCE_BASE_URL);
    if (query) {
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    }
    const buffer = await this.requestBuffer(url);
    return JSON.parse(Buffer.from(buffer).toString('utf-8')) as T;
  }

  private async requestBuffer(url: URL): Promise<ArrayBuffer> {
    let lastError: unknown;
    const attempts = this.env.METEOFRANCE_RETRY_COUNT + 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.env.METEOFRANCE_TIMEOUT_MS);

      try {
        // Portail WSO2 : la cle auto-generee ("API Key", cf. README) se transmet via le header
        // custom "apikey", pas "Authorization: Bearer" (confirme empiriquement le 2026-08-28,
        // "Authorization: Bearer" renvoie 401 Invalid Credentials avec cette meme cle).
        const response = await fetch(url, {
          headers: { apikey: this.env.METEOFRANCE_API_KEY },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new MeteoFranceApiError(`Meteo-France a repondu ${response.status} sur ${url.pathname}`);
        }

        return await response.arrayBuffer();
      } catch (err) {
        lastError = err;
        this.logger.warn({ path: url.pathname, attempt, attempts, err }, 'Echec appel Meteo-France');
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new MeteoFranceApiError(`Echec definitif appel Meteo-France sur ${url.pathname}`, lastError);
  }
}
