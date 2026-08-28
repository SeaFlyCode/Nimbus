import Redis from 'ioredis';
import type { Env } from '../config/env';

export function createRedisClient(env: Env): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
}
