import { describe, expect, it } from 'vitest';
import { bilinearInterpolate, interpolateHourlyEntry, type Grid } from '../src/meteofrance/grid';

describe('bilinearInterpolate', () => {
  const grid: Grid = {
    west: 0,
    south: 0,
    east: 10,
    north: 10,
    width: 2,
    height: 2,
    // ligne 0 = nord (y=10) : [0,0]=10 (nord-ouest), [1,0]=20 (nord-est)
    // ligne 1 = sud (y=0)  : [0,1]=0  (sud-ouest),  [1,1]=30 (sud-est)
    values: [10, 20, 0, 30],
  };

  it('renvoie la valeur exacte sur un coin de la grille', () => {
    expect(bilinearInterpolate(grid, 10, 0)).toBe(10);
    expect(bilinearInterpolate(grid, 10, 10)).toBe(20);
    expect(bilinearInterpolate(grid, 0, 0)).toBe(0);
    expect(bilinearInterpolate(grid, 0, 10)).toBe(30);
  });

  it('interpole au centre de la grille', () => {
    expect(bilinearInterpolate(grid, 5, 5)).toBe(15);
  });

  it('clamp les points hors de la grille sur le bord le plus proche', () => {
    expect(bilinearInterpolate(grid, 100, -100)).toBe(bilinearInterpolate(grid, 10, 0));
  });
});

describe('interpolateHourlyEntry', () => {
  it('construit une HourlyForecastEntry a partir d une grille en cache', () => {
    const entry = interpolateHourlyEntry(
      {
        hourOffset: 1,
        validTime: '2026-08-28T13:00:00.000Z',
        bbox: { west: 0, south: 0, east: 10, north: 10 },
        width: 2,
        height: 2,
        temperatureC: [18, 18, 18, 18],
        precipitationMm: [0, 0, 0, 0],
        windKmh: [12, 12, 12, 12],
      },
      5,
      5,
    );

    expect(entry).toEqual({
      time: '2026-08-28T13:00:00.000Z',
      temperatureC: 18,
      precipitationProbability: 0,
      rainMm: 0,
      windKmh: 12,
    });
  });

  it('deduit une probabilite de precipitation depuis la pluie interpolee', () => {
    const entry = interpolateHourlyEntry(
      {
        hourOffset: 1,
        validTime: '2026-08-28T13:00:00.000Z',
        bbox: { west: 0, south: 0, east: 10, north: 10 },
        width: 2,
        height: 2,
        temperatureC: [10, 10, 10, 10],
        precipitationMm: [2, 2, 2, 2],
        windKmh: [5, 5, 5, 5],
      },
      5,
      5,
    );

    expect(entry.precipitationProbability).toBe(100);
    expect(entry.rainMm).toBe(2);
  });
});
