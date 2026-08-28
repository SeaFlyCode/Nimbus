import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';
import { buildTestEnv } from './support/testEnv';
import { createMockMeteoClient } from './support/mockMeteoClient';

describe('validation des query params', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('rejette des minutes hors bornes sur /radar/history', async () => {
    app = await buildServer(buildTestEnv(), createMockMeteoClient());
    const response = await app.inject({ method: 'GET', url: '/radar/history?minutes=99999' });
    expect(response.statusCode).toBe(400);
  });

  it('rejette un departement invalide sur /alerts', async () => {
    app = await buildServer(buildTestEnv(), createMockMeteoClient());
    const response = await app.inject({ method: 'GET', url: '/alerts?departement=999' });
    expect(response.statusCode).toBe(400);
  });

  it('accepte un departement corse valide sur /alerts', async () => {
    app = await buildServer(buildTestEnv(), createMockMeteoClient());
    const response = await app.inject({ method: 'GET', url: '/alerts?departement=2A' });
    // pas de donnee en cache pour ce departement => 503, mais la validation elle-meme doit passer
    expect(response.statusCode).toBe(503);
  });

  it('rejette une requete de prevision sans coordonnees', async () => {
    app = await buildServer(buildTestEnv(), createMockMeteoClient());
    const response = await app.inject({ method: 'GET', url: '/forecast' });
    expect(response.statusCode).toBe(400);
  });
});
