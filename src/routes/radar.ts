import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { cacheKeys } from '../cache/cache';
import type { RadarTile } from '../meteofrance/client';
import { latSchema, lonSchema, zoomSchema, minutesSchema, errorResponseSchema } from './schemas';

const latestQuerySchema = Type.Object({
  lat: Type.Optional(latSchema),
  lon: Type.Optional(lonSchema),
  zoom: Type.Optional(zoomSchema),
});
type LatestQuery = Static<typeof latestQuerySchema>;

const historyQuerySchema = Type.Object({
  minutes: Type.Optional(minutesSchema),
});
type HistoryQuery = Static<typeof historyQuerySchema>;

function unavailable(reply: FastifyReply, message: string) {
  return reply.code(503).send({ error: 'ServiceUnavailable', message });
}

export async function radarRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: LatestQuery }>(
    '/radar/latest',
    { schema: { querystring: latestQuerySchema, response: { 503: errorResponseSchema } } },
    async (request, reply) => {
      const { lat, lon, zoom } = request.query;
      const anyProvided = lat !== undefined || lon !== undefined || zoom !== undefined;
      const allProvided = lat !== undefined && lon !== undefined && zoom !== undefined;

      if (anyProvided && !allProvided) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'lat, lon et zoom doivent etre fournis ensemble',
        });
      }

      if (!allProvided) {
        const entry = await app.cache.get(cacheKeys.radarMosaic());
        if (!entry) return unavailable(reply, 'Mosaique radar indisponible pour le moment');
        return entry.data;
      }

      return handleTile(app, reply, lat!, lon!, zoom!);
    },
  );

  app.get<{ Querystring: HistoryQuery }>(
    '/radar/history',
    { schema: { querystring: historyQuerySchema, response: { 503: errorResponseSchema } } },
    async (request, reply) => {
      const minutes = request.query.minutes ?? 60;
      const intervalMinutes = Math.max(1, app.env.RADAR_POLL_INTERVAL_MS / 60000);
      const wantedItems = Math.min(
        app.env.RADAR_HISTORY_MAX_ITEMS,
        Math.max(1, Math.ceil(minutes / intervalMinutes)),
      );

      const history = await app.cache.getHistory(cacheKeys.radarHistory(), wantedItems);
      if (history.length === 0) return unavailable(reply, 'Historique radar indisponible pour le moment');

      return { minutes, items: history.map((entry) => entry.data) };
    },
  );
}

async function handleTile(
  app: FastifyInstance,
  reply: FastifyReply,
  lat: number,
  lon: number,
  zoom: number,
) {
  const key = cacheKeys.radarTile(lat, lon, zoom);
  const cached = await app.cache.get<RadarTile>(key);
  if (cached) return cached.data;

  try {
    const tile = await app.meteoClient.getRadarTile(lat, lon, zoom);
    const ttlSeconds = Math.ceil((app.env.RADAR_POLL_INTERVAL_MS * app.env.FRESHNESS_STALE_MULTIPLIER * 2) / 1000);
    await app.cache.set(key, tile, ttlSeconds);
    return tile;
  } catch (err) {
    app.log.error({ err, lat, lon, zoom }, 'Echec recuperation tuile radar');
    return unavailable(reply, 'Tuile radar momentanement indisponible');
  }
}
