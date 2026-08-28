import type { Env } from '../config/env';
import type { AppLogger } from '../logger';

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

export interface Forecast {
  fetchedAt: string;
  lat: number;
  lon: number;
  hourly: HourlyForecastEntry[];
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
  getForecast(lat: number, lon: number): Promise<Forecast>;
  getVigilance(departement: string): Promise<Vigilance>;
}

export class MeteoFranceApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MeteoFranceApiError';
  }
}

// TODO: les chemins d'endpoint exacts dependent de l'offre souscrite sur le portail
// (ex: "public/DPRadar/v1/..." pour le radar, "public/DPPromethee/v1/..." pour la prevision,
// "DPVigilance/v1/..." pour la vigilance). A verifier/ajuster avec un vrai token sur
// https://portail-api.meteofrance.fr une fois l'abonnement actif.
const ENDPOINTS = {
  radarMosaic: '/public/DPRadar/v1/mosaic/FRANCE',
  radarTile: '/public/DPRadar/v1/tile',
  forecast: '/public/DPPromethee/v1/forecast',
  vigilance: '/public/DPVigilance/v1/textesvigilance/encours',
} as const;

export class HttpMeteoFranceClient implements MeteoFranceClient {
  constructor(private readonly env: Env, private readonly logger: AppLogger) {}

  async getRadarMosaic(): Promise<RadarMosaic> {
    const data = await this.request<{ image_url: string }>(ENDPOINTS.radarMosaic);
    return { fetchedAt: new Date().toISOString(), imageUrl: data.image_url };
  }

  async getRadarTile(lat: number, lon: number, zoom: number): Promise<RadarTile> {
    const data = await this.request<{ image_url: string }>(ENDPOINTS.radarTile, {
      lat: String(lat),
      lon: String(lon),
      zoom: String(zoom),
    });
    return { fetchedAt: new Date().toISOString(), lat, lon, zoom, imageUrl: data.image_url };
  }

  async getForecast(lat: number, lon: number): Promise<Forecast> {
    const data = await this.request<{ hourly: HourlyForecastEntry[] }>(ENDPOINTS.forecast, {
      lat: String(lat),
      lon: String(lon),
    });
    return { fetchedAt: new Date().toISOString(), lat, lon, hourly: data.hourly };
  }

  async getVigilance(departement: string): Promise<Vigilance> {
    const data = await this.request<{ color: Vigilance['color']; risks: string[] }>(
      ENDPOINTS.vigilance,
      { departement },
    );
    return {
      fetchedAt: new Date().toISOString(),
      departement,
      color: data.color,
      risks: data.risks,
    };
  }

  private async request<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.env.METEOFRANCE_BASE_URL);
    if (query) {
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    }

    let lastError: unknown;
    const attempts = this.env.METEOFRANCE_RETRY_COUNT + 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.env.METEOFRANCE_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.env.METEOFRANCE_TOKEN}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new MeteoFranceApiError(
            `Meteo-France a repondu ${response.status} sur ${path}`,
          );
        }

        return (await response.json()) as T;
      } catch (err) {
        lastError = err;
        this.logger.warn(
          { path, attempt, attempts, err },
          'Echec appel Meteo-France',
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new MeteoFranceApiError(`Echec definitif appel Meteo-France sur ${path}`, lastError);
  }
}
