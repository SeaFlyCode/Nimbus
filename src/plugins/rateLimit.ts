import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Env } from '../config/env';
import { createRedisClient } from '../cache/redis';

export async function registerRateLimit(app: FastifyInstance, env: Env): Promise<void> {
  const redis = createRedisClient(env);
  app.addHook('onClose', async () => {
    await redis.quit();
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    redis,
    nameSpace: 'nimbus-rl:',
    keyGenerator: (request) => request.clientName || request.ip,
  });
}
