import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { DataKind } from '../cache/cache';
import { freshnessThresholdMs } from '../jobs/scheduler';

const FAILURE_THRESHOLD = 3;

const healthResponseSchema = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
  data: Type.Record(
    Type.String(),
    Type.Object({
      lastFetchedAt: Type.Union([Type.String(), Type.Null()]),
      ageSeconds: Type.Union([Type.Number(), Type.Null()]),
      consecutiveFailures: Type.Number(),
      status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
    }),
  ),
});

const pollIntervalByKind: Record<DataKind, keyof import('../config/env').Env> = {
  radar: 'RADAR_POLL_INTERVAL_MS',
  forecast: 'FORECAST_POLL_INTERVAL_MS',
  alerts: 'ALERTS_POLL_INTERVAL_MS',
};

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { schema: { response: { 200: healthResponseSchema } } }, async () => {
    const kinds: DataKind[] = ['radar', 'forecast', 'alerts'];
    const data: Record<string, unknown> = {};
    let overallOk = true;

    for (const kind of kinds) {
      const [lastFetchedAt, consecutiveFailures] = await Promise.all([
        app.cache.getLastFetchedAt(kind),
        app.cache.getConsecutiveFailures(kind),
      ]);

      const pollIntervalMs = app.env[pollIntervalByKind[kind]] as number;
      const threshold = freshnessThresholdMs(app.env, pollIntervalMs);
      const ageMs = lastFetchedAt ? Date.now() - new Date(lastFetchedAt).getTime() : null;
      const isStale = ageMs === null || ageMs > threshold;
      const tooManyFailures = consecutiveFailures >= FAILURE_THRESHOLD;
      const status = isStale || tooManyFailures ? 'degraded' : 'ok';
      if (status === 'degraded') overallOk = false;

      data[kind] = {
        lastFetchedAt,
        ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
        consecutiveFailures,
        status,
      };
    }

    return { status: overallOk ? 'ok' : 'degraded', data };
  });
}
