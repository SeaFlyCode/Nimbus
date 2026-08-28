import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { cacheKeys } from '../cache/cache';
import type { ForecastHourCacheEntry } from '../meteofrance/grid';
import { interpolateHourlyEntry } from '../meteofrance/grid';
import { FORECAST_HOUR_OFFSETS } from '../meteofrance/forecastPlan';
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

      // Lecture cache pure : les grilles sont pre-chargees par le scheduler (rate-limit AROME
      // incompatible avec un fetch par requete client), on interpole juste le point demande.
      const entries = [];
      for (const hourOffset of FORECAST_HOUR_OFFSETS) {
        const cached = await app.cache.get<ForecastHourCacheEntry>(cacheKeys.forecastGrid(hourOffset));
        if (!cached) continue;
        entries.push(interpolateHourlyEntry(cached.data, lat, lon));
      }

      if (entries.length === 0) {
        return reply.code(503).send({
          error: 'ServiceUnavailable',
          message: 'Prevision momentanement indisponible',
        });
      }

      return entries;
    },
  );
}
