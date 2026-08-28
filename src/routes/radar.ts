import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { cacheKeys } from '../cache/cache';
import { minutesSchema, errorResponseSchema } from './schemas';

const historyQuerySchema = Type.Object({
  minutes: Type.Optional(minutesSchema),
});
type HistoryQuery = Static<typeof historyQuerySchema>;

function unavailable(reply: FastifyReply, message: string) {
  return reply.code(503).send({ error: 'ServiceUnavailable', message });
}

export async function radarRoutes(app: FastifyInstance): Promise<void> {
  // Le paquet radar Meteo-France ne fournit pas de decoupage par tuile/zoom cote serveur :
  // il renvoie une mosaique complete (metropole + outre-mer) par cycle. Le crop/zoom se fait
  // cote client sur cette image.
  app.get(
    '/radar/latest',
    { schema: { response: { 503: errorResponseSchema } } },
    async (_request, reply) => {
      const entry = await app.cache.get(cacheKeys.radarMosaic());
      if (!entry) return unavailable(reply, 'Mosaique radar indisponible pour le moment');
      return entry.data;
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
