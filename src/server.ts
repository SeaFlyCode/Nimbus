import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Env } from './config/env';
import type { MeteoFranceClient } from './meteofrance/client';
import { registerCache } from './plugins/redis';
import { registerApiKeyAuth } from './plugins/apiKeyAuth';
import { registerRateLimit } from './plugins/rateLimit';
import { registerSwagger } from './plugins/swagger';
import { healthRoutes } from './routes/health';
import { radarRoutes } from './routes/radar';
import { forecastRoutes } from './routes/forecast';
import { alertsRoutes } from './routes/alerts';

export async function buildServer(env: Env, meteoClient: MeteoFranceClient): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  });

  app.decorate('env', env);
  app.decorate('meteoClient', meteoClient);

  await app.register(cors, { origin: true });

  registerCache(app, env);
  registerApiKeyAuth(app, env);
  await registerRateLimit(app, env);
  await registerSwagger(app);

  await app.register(healthRoutes);
  await app.register(radarRoutes);
  await app.register(forecastRoutes);
  await app.register(alertsRoutes);

  return app;
}
