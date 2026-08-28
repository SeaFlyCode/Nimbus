import type { Redis } from 'ioredis';

export interface CacheEntry<T> {
  data: T;
  lastFetchedAt: string;
}

export type DataKind = 'radar' | 'forecast' | 'alerts';

const KEY_PREFIX = 'nimbus';

export const cacheKeys = {
  radarMosaic: () => `${KEY_PREFIX}:radar:mosaic`,
  radarTile: (lat: number, lon: number, zoom: number) =>
    `${KEY_PREFIX}:radar:tile:${lat.toFixed(2)}:${lon.toFixed(2)}:${zoom}`,
  radarHistory: () => `${KEY_PREFIX}:radar:history`,
  forecast: (lat: number, lon: number) =>
    `${KEY_PREFIX}:forecast:${lat.toFixed(2)}:${lon.toFixed(2)}`,
  vigilance: (departement: string) => `${KEY_PREFIX}:alerts:${departement}`,
  consecutiveFailures: (kind: DataKind) => `${KEY_PREFIX}:failures:${kind}`,
  lastFetchedAt: (kind: DataKind) => `${KEY_PREFIX}:last-fetched:${kind}`,
};

export class CacheStore {
  constructor(private readonly redis: Redis) {}

  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    const entry: CacheEntry<T> = { data, lastFetchedAt: new Date().toISOString() };
    await this.redis.set(key, JSON.stringify(entry), 'EX', ttlSeconds);
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  }

  // TTL restant, en secondes negatives/absentes si la cle n'existe pas (-2) ou n'a pas d'expiration (-1).
  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  async pushHistory<T>(key: string, data: T, maxItems: number): Promise<void> {
    const entry: CacheEntry<T> = { data, lastFetchedAt: new Date().toISOString() };
    const pipeline = this.redis.pipeline();
    pipeline.lpush(key, JSON.stringify(entry));
    pipeline.ltrim(key, 0, maxItems - 1);
    await pipeline.exec();
  }

  async getHistory<T>(key: string, limit: number): Promise<CacheEntry<T>[]> {
    const raw = await this.redis.lrange(key, 0, limit - 1);
    return raw.map((item) => JSON.parse(item) as CacheEntry<T>);
  }

  async getConsecutiveFailures(kind: DataKind): Promise<number> {
    const raw = await this.redis.get(cacheKeys.consecutiveFailures(kind));
    return raw ? Number(raw) : 0;
  }

  async incrementFailures(kind: DataKind): Promise<number> {
    return this.redis.incr(cacheKeys.consecutiveFailures(kind));
  }

  async resetFailures(kind: DataKind): Promise<void> {
    await this.redis.set(cacheKeys.consecutiveFailures(kind), 0);
  }

  // Suivi global "derniere donnee fraiche obtenue pour ce type", independant des cles par
  // parametre (tuile/lat-lon/departement), pour un /health simple et lisible.
  async markFetched(kind: DataKind): Promise<void> {
    await this.redis.set(cacheKeys.lastFetchedAt(kind), new Date().toISOString());
  }

  async getLastFetchedAt(kind: DataKind): Promise<string | null> {
    return this.redis.get(cacheKeys.lastFetchedAt(kind));
  }
}
