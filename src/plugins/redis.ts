import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';
import { createRedisClient } from '../cache/redis';
import { CacheStore } from '../cache/cache';

declare module 'fastify' {
  interface FastifyInstance {
    cache: CacheStore;
  }
}

export function registerCache(app: FastifyInstance, env: Env): void {
  const redis = createRedisClient(env);
  const cache = new CacheStore(redis);

  app.decorate('cache', cache);
  app.addHook('onClose', async () => {
    await redis.quit();
  });
}
