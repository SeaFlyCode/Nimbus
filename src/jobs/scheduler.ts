import type { Env } from '../config/env';
import type { AppLogger } from '../logger';
import type { MeteoFranceClient } from '../meteofrance/client';
import { CacheStore, cacheKeys, type DataKind } from '../cache/cache';
import { FRENCH_DEPARTMENT_CODES } from './departments';

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
    const ttl = ttlSecondsFor(this.env, this.env.ALERTS_POLL_INTERVAL_MS);
    const results = await Promise.allSettled(
      FRENCH_DEPARTMENT_CODES.map(async (departement) => {
        const vigilance = await this.client.getVigilance(departement);
        await this.cache.set(cacheKeys.vigilance(departement), vigilance, ttl);
      }),
    );
    const failedCount = results.filter((r) => r.status === 'rejected').length;
    if (failedCount === results.length) {
      throw new Error('Echec de tous les departements lors du polling vigilance');
    }
    if (failedCount > 0) {
      this.logger.warn({ failedCount, total: results.length }, 'Polling vigilance partiellement en echec');
    }
    await this.cache.markFetched('alerts');
  }
}
