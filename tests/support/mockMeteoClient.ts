import { vi } from 'vitest';
import type { MeteoFranceClient } from '../../src/meteofrance/client';

export function createMockMeteoClient(): MeteoFranceClient {
  return {
    getRadarMosaic: vi.fn().mockResolvedValue({
      fetchedAt: new Date().toISOString(),
      validTime: new Date().toISOString(),
      corners: { ul: [51, -5], ur: [51, 9], ll: [42, -5], lr: [42, 9] },
      imageBase64: 'mock-png-base64',
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
