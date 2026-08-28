import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { cacheKeys } from '../cache/cache';
import { latSchema, lonSchema, errorResponseSchema } from './schemas';

const forecastQuerySchema = Type.Object({
  lat: latSchema,
  lon: lonSchema,
});
type ForecastQuery = Static<typeof forecastQuerySchema>;

export async function forecastRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ForecastQuery }>(
    '/forecast',
    { schema: { querystring: forecastQuerySchema, response: { 503: errorResponseSchema } } },
    async (request, reply) => {
      const { lat, lon } = request.query;
      return handleForecast(app, reply, lat, lon);
    },
  );
}

// Cache-first : le cache est le point de mutualisation des appels Meteo-France entre clients,
// donc on ne rappelle l'API distante que sur un vrai miss (cle absente ou expiree).
async function handleForecast(app: FastifyInstance, reply: FastifyReply, lat: number, lon: number) {
  const key = cacheKeys.forecast(lat, lon);
  const cached = await app.cache.get(key);
  if (cached) return cached.data;

  try {
    const forecast = await app.meteoClient.getForecast(lat, lon);
    const ttlSeconds = Math.ceil(
      (app.env.FORECAST_POLL_INTERVAL_MS * app.env.FRESHNESS_STALE_MULTIPLIER * 2) / 1000,
    );
    await app.cache.set(key, forecast, ttlSeconds);
    await app.cache.markFetched('forecast');
    await app.cache.resetFailures('forecast');
    return forecast;
  } catch (err) {
    await app.cache.incrementFailures('forecast');
    app.log.error({ err, lat, lon }, 'Echec recuperation prevision');
    return reply.code(503).send({
      error: 'ServiceUnavailable',
      message: 'Prevision momentanement indisponible',
    });
  }
}
