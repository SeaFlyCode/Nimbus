import { afterEach, describe, expect, it } from 'vitest';
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

    const cached = {
      fetchedAt: new Date().toISOString(),
      validTime: new Date().toISOString(),
      corners: { ul: [51, -5] as [number, number], ur: [51, 9] as [number, number], ll: [42, -5] as [number, number], lr: [42, 9] as [number, number] },
      imageBase64: 'cached-png-base64',
    };
    await app.cache.set(cacheKeys.radarMosaic(), cached, 60);
    const response = await app.inject({ method: 'GET', url: '/radar/latest' });

    expect(response.statusCode).toBe(200);
    expect(response.json().imageBase64).toBe('cached-png-base64');
    expect(client.getRadarMosaic).not.toHaveBeenCalled();
  });

  it('sert /forecast depuis le cache sans jamais appeler Meteo-France', async () => {
    const client = createMockMeteoClient();
    app = await buildServer(buildTestEnv(), client);

    await app.cache.set(
      cacheKeys.forecastGrid(1),
      {
        hourOffset: 1,
        validTime: new Date().toISOString(),
        bbox: { west: -5.5, south: 41, east: 10, north: 51.5 },
        width: 2,
        height: 2,
        temperatureC: [18, 18, 18, 18],
        precipitationMm: [0, 0, 0, 0],
        windKmh: [10, 10, 10, 10],
      },
      60,
    );
    const response = await app.inject({ method: 'GET', url: '/forecast?lat=48.85&lon=2.35' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0].temperatureC).toBe(18);
    expect(client.getForecastGrid).not.toHaveBeenCalled();
  });

  it('renvoie 503 si aucune grille de prevision n est en cache', async () => {
    const client = createMockMeteoClient();
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
