import { describe, expect, it } from 'vitest';
import { CacheStore, cacheKeys } from '../src/cache/cache';
import { FakeRedis } from './support/fakeRedis';

describe('CacheStore', () => {
  it('round-trips a value with get/set', async () => {
    const cache = new CacheStore(new FakeRedis() as any);
    await cache.set('k', { hello: 'world' }, 60);

    const entry = await cache.get<{ hello: string }>('k');

    expect(entry?.data).toEqual({ hello: 'world' });
    expect(entry?.lastFetchedAt).toBeTypeOf('string');
  });

  it('returns null on a missing key', async () => {
    const cache = new CacheStore(new FakeRedis() as any);
    expect(await cache.get('missing')).toBeNull();
  });

  it('bounds the sliding history list to maxItems', async () => {
    const cache = new CacheStore(new FakeRedis() as any);
    const key = cacheKeys.radarHistory();

    for (let i = 0; i < 5; i++) {
      await cache.pushHistory(key, { i }, 3);
    }

    const history = await cache.getHistory<{ i: number }>(key, 10);
    expect(history).toHaveLength(3);
    // le plus recent (i=4) doit etre en tete
    expect(history[0].data).toEqual({ i: 4 });
  });

  it('tracks consecutive failures and resets them', async () => {
    const cache = new CacheStore(new FakeRedis() as any);

    await cache.incrementFailures('radar');
    await cache.incrementFailures('radar');
    expect(await cache.getConsecutiveFailures('radar')).toBe(2);

    await cache.resetFailures('radar');
    expect(await cache.getConsecutiveFailures('radar')).toBe(0);
  });

  it('records and reads back lastFetchedAt per kind', async () => {
    const cache = new CacheStore(new FakeRedis() as any);
    expect(await cache.getLastFetchedAt('alerts')).toBeNull();

    await cache.markFetched('alerts');
    const value = await cache.getLastFetchedAt('alerts');
    expect(value).toBeTypeOf('string');
  });
});
