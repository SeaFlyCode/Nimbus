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
    getForecastGrid: vi.fn().mockImplementation((param, hourOffset) =>
      Promise.resolve({
        param,
        hourOffset,
        validTime: new Date().toISOString(),
        west: -5.5,
        south: 41,
        east: 10,
        north: 51.5,
        width: 2,
        height: 2,
        values: [18, 18, 18, 18],
      }),
    ),
    getVigilanceMap: vi.fn().mockResolvedValue({
      '75': { fetchedAt: new Date().toISOString(), departement: '75', color: 'vert', risks: [] },
    }),
  };
}
