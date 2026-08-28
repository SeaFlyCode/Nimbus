import { vi } from 'vitest';
import type { MeteoFranceClient } from '../../src/meteofrance/client';

export function createMockMeteoClient(): MeteoFranceClient {
  return {
    getRadarMosaic: vi.fn().mockResolvedValue({
      fetchedAt: new Date().toISOString(),
      imageUrl: 'https://example.test/mosaic.png',
    }),
    getRadarTile: vi.fn().mockResolvedValue({
      fetchedAt: new Date().toISOString(),
      lat: 48.85,
      lon: 2.35,
      zoom: 8,
      imageUrl: 'https://example.test/tile.png',
    }),
    getForecast: vi.fn().mockResolvedValue({
      fetchedAt: new Date().toISOString(),
      lat: 48.85,
      lon: 2.35,
      hourly: [
        { time: new Date().toISOString(), temperatureC: 18, precipitationProbability: 20, rainMm: 0, windKmh: 10 },
      ],
    }),
    getVigilance: vi.fn().mockResolvedValue({
      fetchedAt: new Date().toISOString(),
      departement: '75',
      color: 'vert',
      risks: [],
    }),
  };
}
