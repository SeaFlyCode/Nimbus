import { loadEnv } from './config/env';
import { HttpMeteoFranceClient } from './meteofrance/client';
import { CacheStore } from './cache/cache';
import { createRedisClient } from './cache/redis';
import { Scheduler } from './jobs/scheduler';
import { buildServer } from './server';

async function main() {
  const env = loadEnv();
  const bootstrapLogger = (await import('pino')).default({ level: env.LOG_LEVEL });

  const meteoClient = new HttpMeteoFranceClient(env, bootstrapLogger);
  const app = await buildServer(env, meteoClient);

  const schedulerRedis = createRedisClient(env);
  const scheduler = new Scheduler(env, meteoClient, new CacheStore(schedulerRedis), app.log);
  scheduler.start();

  const shutdown = async () => {
    scheduler.stop();
    await schedulerRedis.quit();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Echec du demarrage du serveur:', err);
  process.exit(1);
});
