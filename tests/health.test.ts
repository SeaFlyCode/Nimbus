import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';
import { buildTestEnv } from './support/testEnv';
import { createMockMeteoClient } from './support/mockMeteoClient';

describe('GET /health', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reports degraded when no data has ever been fetched', async () => {
    const env = buildTestEnv();
    app = await buildServer(env, createMockMeteoClient());

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.data.radar.status).toBe('degraded');
    expect(body.data.radar.lastFetchedAt).toBeNull();
  });

  it('reports ok once data was marked as freshly fetched', async () => {
    const env = buildTestEnv();
    app = await buildServer(env, createMockMeteoClient());

    await app.cache.markFetched('radar');
    await app.cache.markFetched('forecast');
    await app.cache.markFetched('alerts');

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(body.status).toBe('ok');
    expect(body.data.radar.status).toBe('ok');
  });

  it('reports degraded after repeated consecutive failures even if recently fetched', async () => {
    const env = buildTestEnv();
    app = await buildServer(env, createMockMeteoClient());

    await app.cache.markFetched('radar');
    await app.cache.incrementFailures('radar');
    await app.cache.incrementFailures('radar');
    await app.cache.incrementFailures('radar');

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(body.data.radar.status).toBe('degraded');
    expect(body.status).toBe('degraded');
  });
});
