import { fromArrayBuffer } from 'geotiff';
import type { Env } from '../config/env';
import type { AppLogger } from '../logger';
import type { Grid } from './grid';

export interface RadarMosaic {
  fetchedAt: string;
  imageUrl: string;
  imageBase64?: string;
}

export interface RadarTile {
  fetchedAt: string;
  lat: number;
  lon: number;
  zoom: number;
  imageUrl: string;
  imageBase64?: string;
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
  getRadarTile(lat: number, lon: number, zoom: number): Promise<RadarTile>;
  getForecastGrid(param: ForecastParam, hourOffset: number): Promise<ForecastGrid>;
  getVigilanceMap(): Promise<Record<string, Vigilance>>;
}

export class MeteoFranceApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MeteoFranceApiError';
  }
}

// TODO: chemins a confirmer avec un vrai compte sur https://portail-api.meteofrance.fr
// (la doc Swagger complete n'est accessible qu'authentifie). "mosaiques" est le nom de
// produit indique par le portail pour DPRadar ; le sous-chemin exact de l'image France
// (identifiant de mosaique ? parametre de zone ?) reste a verifier.
const ENDPOINTS = {
  radarMosaic: '/public/DPRadar/v1/mosaiques/FRANCE',
  radarTile: '/public/DPRadar/v1/mosaiques/tile',
  vigilanceCarte: '/public/DPVigilance/v1/cartevigilance/encours',
  aromeWcs: '/public/arome/1.0/wcs/MF-NWP-HIGHRES-AROME-001-FRANCE-WCS/GetCoverage',
} as const;

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

function downsampleStride(width: number, height: number): number {
  return Math.max(1, Math.ceil(Math.max(width, height) / MAX_GRID_DIMENSION));
}

interface RawVigilanceDomainEntry {
  domain_id: string;
  max_color_id: string;
  phenomenon_max_colors?: Array<{ phenomenon_id: string; phenomenon_max_color_id: string }>;
}

interface RawVigilanceCarte {
  periods?: Array<{
    echeance?: string;
    timelaps?: { domain_ids?: RawVigilanceDomainEntry[] };
  }>;
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

// TODO: forme exacte de la reponse cartevigilance/encours a confirmer avec un vrai payload
// (doc Swagger authentifiee uniquement). Structure vraisemblable d'apres la documentation
// publique historique de la vigilance Meteo-France (echeances "J"/"J1", une entree par
// domaine/departement avec une couleur max et la liste des phenomenes concernes).
export function parseVigilanceCarte(raw: unknown, fetchedAt: string): Record<string, Vigilance> {
  const carte = raw as RawVigilanceCarte;
  const currentPeriod = carte.periods?.find((p) => p.echeance === 'J') ?? carte.periods?.[0];
  const domains = currentPeriod?.timelaps?.domain_ids ?? [];

  const result: Record<string, Vigilance> = {};
  for (const domain of domains) {
    const color = VIGILANCE_COLOR_BY_ID[domain.max_color_id] ?? 'vert';
    const risks = (domain.phenomenon_max_colors ?? [])
      .filter((p) => (VIGILANCE_COLOR_BY_ID[p.phenomenon_max_color_id] ?? 'vert') !== 'vert')
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

// Rafraichit l'access_token OAuth2 (client_credentials) et le met en cache memoire jusqu'a
// une marge avant expiration. Les refresh concurrents partagent la meme promesse en cours
// pour eviter de spammer /token si plusieurs requetes arrivent pendant un refresh.
const TOKEN_REFRESH_MARGIN_MS = 60_000;

class MeteoFranceTokenProvider {
  private token?: { accessToken: string; expiresAt: number };
  private pending?: Promise<string>;

  constructor(private readonly env: Env) {}

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt > Date.now()) {
      return this.token.accessToken;
    }
    if (!this.pending) {
      this.pending = this.fetchToken().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  invalidate(): void {
    this.token = undefined;
  }

  private async fetchToken(): Promise<string> {
    const response = await fetch(this.env.METEOFRANCE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.env.METEOFRANCE_APPLICATION_ID}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      throw new MeteoFranceApiError(`Echec obtention token Meteo-France (${response.status})`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS,
    };
    return this.token.accessToken;
  }
}

export class HttpMeteoFranceClient implements MeteoFranceClient {
  private readonly tokenProvider: MeteoFranceTokenProvider;

  constructor(private readonly env: Env, private readonly logger: AppLogger) {
    this.tokenProvider = new MeteoFranceTokenProvider(env);
  }

  async getRadarMosaic(): Promise<RadarMosaic> {
    const data = await this.requestJson<{ image_url: string }>(ENDPOINTS.radarMosaic);
    return { fetchedAt: new Date().toISOString(), imageUrl: data.image_url };
  }

  async getRadarTile(lat: number, lon: number, zoom: number): Promise<RadarTile> {
    const data = await this.requestJson<{ image_url: string }>(ENDPOINTS.radarTile, {
      lat: String(lat),
      lon: String(lon),
      zoom: String(zoom),
    });
    return { fetchedAt: new Date().toISOString(), lat, lon, zoom, imageUrl: data.image_url };
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
        const accessToken = await this.tokenProvider.getAccessToken();
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });

        if (response.status === 401) {
          this.tokenProvider.invalidate();
          throw new MeteoFranceApiError(`Meteo-France a repondu 401 sur ${url.pathname}`);
        }

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
