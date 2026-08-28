import type { Env } from '../config/env';
import type { AppLogger } from '../logger';
import type { ForecastGrid, MeteoFranceClient } from '../meteofrance/client';
import type { ForecastHourCacheEntry } from '../meteofrance/grid';
import { FORECAST_HOUR_OFFSETS, FORECAST_PARAMS } from '../meteofrance/forecastPlan';
import { CacheStore, cacheKeys, type DataKind } from '../cache/cache';
import { RateThrottle } from '../utils/throttle';

// 50 req/min sur l'API AROME => >= 1.2s entre deux appels ; marge a 1.3s.
const AROME_MIN_INTERVAL_MS = 1300;

// TTL cache volontairement plus grand que le seuil "degraded" de /health : si Meteo-France
// est en panne, on veut pouvoir continuer a servir la derniere donnee connue (fallback) meme
// une fois qu'elle est jugee perimee par /health, plutot que de perdre la cle en meme temps.
function ttlSecondsFor(env: Env, pollIntervalMs: number): number {
  return Math.ceil((pollIntervalMs * env.FRESHNESS_STALE_MULTIPLIER * 2) / 1000);
}

export function freshnessThresholdMs(env: Env, pollIntervalMs: number): number {
  return pollIntervalMs * env.FRESHNESS_STALE_MULTIPLIER;
}

interface PollJob {
  kind: DataKind;
  intervalMs: number;
  run: () => Promise<void>;
}

export class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private readonly aromeThrottle = new RateThrottle(AROME_MIN_INTERVAL_MS);

  constructor(
    private readonly env: Env,
    private readonly client: MeteoFranceClient,
    private readonly cache: CacheStore,
    private readonly logger: AppLogger,
  ) {}

  start(): void {
    const jobs: PollJob[] = [
      {
        kind: 'radar',
        intervalMs: this.env.RADAR_POLL_INTERVAL_MS,
        run: () => this.pollRadarMosaic(),
      },
      {
        kind: 'alerts',
        intervalMs: this.env.ALERTS_POLL_INTERVAL_MS,
        run: () => this.pollVigilance(),
      },
      {
        kind: 'forecast',
        intervalMs: this.env.FORECAST_POLL_INTERVAL_MS,
        run: () => this.pollForecast(),
      },
    ];

    for (const job of jobs) {
      void this.runAndCatch(job);
      const timer = setInterval(() => void this.runAndCatch(job), job.intervalMs);
      this.timers.push(timer);
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private async runAndCatch(job: PollJob): Promise<void> {
    try {
      await job.run();
      await this.cache.resetFailures(job.kind);
    } catch (err) {
      const failures = await this.cache.incrementFailures(job.kind);
      this.logger.error({ kind: job.kind, failures, err }, 'Echec du job de polling');
    }
  }

  private async pollRadarMosaic(): Promise<void> {
    const mosaic = await this.client.getRadarMosaic();
    const ttl = ttlSecondsFor(this.env, this.env.RADAR_POLL_INTERVAL_MS);
    await this.cache.set(cacheKeys.radarMosaic(), mosaic, ttl);
    await this.cache.pushHistory(cacheKeys.radarHistory(), mosaic, this.env.RADAR_HISTORY_MAX_ITEMS);
    await this.cache.markFetched('radar');
  }

  private async pollVigilance(): Promise<void> {
    // cartevigilance/encours renvoie la carte du pays entier en un seul appel : pas besoin
    // de boucler par departement.
    const ttl = ttlSecondsFor(this.env, this.env.ALERTS_POLL_INTERVAL_MS);
    const vigilanceByDepartement = await this.client.getVigilanceMap();
    const departements = Object.keys(vigilanceByDepartement);
    if (departements.length === 0) {
      throw new Error('Reponse vigilance vide lors du polling');
    }
    await Promise.all(
      departements.map((departement) =>
        this.cache.set(cacheKeys.vigilance(departement), vigilanceByDepartement[departement], ttl),
      ),
    );
    await this.cache.markFetched('alerts');
  }

  // Pre-charge un petit ensemble d'echeances/parametres AROME, mutualise entre tous les
  // clients : le rate-limit AROME (50 req/min) ne permettrait pas un fetch par requete client.
  private async pollForecast(): Promise<void> {
    const ttl = ttlSecondsFor(this.env, this.env.FORECAST_POLL_INTERVAL_MS);
    let successCount = 0;

    for (const hourOffset of FORECAST_HOUR_OFFSETS) {
      try {
        const entry = await this.fetchForecastHour(hourOffset);
        await this.cache.set(cacheKeys.forecastGrid(hourOffset), entry, ttl);
        successCount++;
      } catch (err) {
        this.logger.warn({ hourOffset, err }, 'Echec recuperation grille prevision');
      }
    }

    if (successCount === 0) {
      throw new Error('Echec de toutes les echeances lors du polling prevision');
    }
    await this.cache.markFetched('forecast');
  }

  private async fetchForecastHour(hourOffset: number): Promise<ForecastHourCacheEntry> {
    const grids: Partial<Record<ForecastGrid['param'], ForecastGrid>> = {};
    for (const param of FORECAST_PARAMS) {
      grids[param] = await this.aromeThrottle.run(() => this.client.getForecastGrid(param, hourOffset));
    }

    const temperature = grids.TEMPERATURE!;
    return {
      hourOffset,
      validTime: temperature.validTime,
      bbox: { west: temperature.west, south: temperature.south, east: temperature.east, north: temperature.north },
      width: temperature.width,
      height: temperature.height,
      temperatureC: temperature.values,
      precipitationMm: grids.PRECIPITATION!.values,
      windKmh: grids.WIND_SPEED!.values,
    };
  }
}
