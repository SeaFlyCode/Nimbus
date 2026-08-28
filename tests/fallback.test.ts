import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';
import { buildTestEnv } from './support/testEnv';
import { createMockMeteoClient } from './support/mockMeteoClient';
import { cacheKeys } from '../src/cache/cache';

describe('fallback sur le cache', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('renvoie 503 explicite si /radar/latest n a rien en cache', async () => {
    app = await buildServer(buildTestEnv(), createMockMeteoClient());
    const response = await app.inject({ method: 'GET', url: '/radar/latest' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('ServiceUnavailable');
  });

  it('sert la mosaique radar depuis le cache sans appeler Meteo-France', async () => {
    const client = createMockMeteoClient();
    app = await buildServer(buildTestEnv(), client);

    await app.cache.set(cacheKeys.radarMosaic(), { imageUrl: 'cached.png' }, 60);
    const response = await app.inject({ method: 'GET', url: '/radar/latest' });

    expect(response.statusCode).toBe(200);
    expect(response.json().imageUrl).toBe('cached.png');
    expect(client.getRadarMosaic).not.toHaveBeenCalled();
  });

  it('sert /forecast depuis le cache sans rappeler Meteo-France sur un hit', async () => {
    const client = createMockMeteoClient();
    app = await buildServer(buildTestEnv(), client);

    await app.cache.set(cacheKeys.forecast(48.85, 2.35), { hourly: [] }, 60);
    const response = await app.inject({ method: 'GET', url: '/forecast?lat=48.85&lon=2.35' });

    expect(response.statusCode).toBe(200);
    expect(client.getForecast).not.toHaveBeenCalled();
  });

  it('interroge Meteo-France sur un miss puis met en cache le resultat', async () => {
    const client = createMockMeteoClient();
    app = await buildServer(buildTestEnv(), client);

    const response = await app.inject({ method: 'GET', url: '/forecast?lat=48.85&lon=2.35' });

    expect(response.statusCode).toBe(200);
    expect(client.getForecast).toHaveBeenCalledWith(48.85, 2.35);

    const cached = await app.cache.get(cacheKeys.forecast(48.85, 2.35));
    expect(cached).not.toBeNull();
  });

  it('renvoie 503 si Meteo-France echoue et qu il n y a rien en cache', async () => {
    const client = createMockMeteoClient();
    (client.getForecast as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    app = await buildServer(buildTestEnv(), client);

    const response = await app.inject({ method: 'GET', url: '/forecast?lat=48.85&lon=2.35' });
    expect(response.statusCode).toBe(503);
  });

  it('renvoie 503 explicite sur /alerts si le departement n a pas ete pre-charge', async () => {
    app = await buildServer(buildTestEnv(), createMockMeteoClient());
    const response = await app.inject({ method: 'GET', url: '/alerts?departement=75' });
    expect(response.statusCode).toBe(503);
  });

  it('sert /alerts depuis le cache pre-charge par le scheduler', async () => {
    app = await buildServer(buildTestEnv(), createMockMeteoClient());
    await app.cache.set(cacheKeys.vigilance('75'), { departement: '75', color: 'vert' }, 60);

    const response = await app.inject({ method: 'GET', url: '/alerts?departement=75' });
    expect(response.statusCode).toBe(200);
    expect(response.json().color).toBe('vert');
  });
});
