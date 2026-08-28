import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { cacheKeys } from '../cache/cache';
import { departementSchema, errorResponseSchema } from './schemas';

const alertsQuerySchema = Type.Object({
  departement: departementSchema,
});
type AlertsQuery = Static<typeof alertsQuerySchema>;

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: AlertsQuery }>(
    '/alerts',
    { schema: { querystring: alertsQuerySchema, response: { 503: errorResponseSchema } } },
    async (request, reply) => {
      const departement = request.query.departement.toUpperCase();
      const entry = await app.cache.get(cacheKeys.vigilance(departement));

      if (!entry) {
        return reply.code(503).send({
          error: 'ServiceUnavailable',
          message: `Vigilance indisponible pour le departement ${departement}`,
        });
      }

      return entry.data;
    },
  );
}
