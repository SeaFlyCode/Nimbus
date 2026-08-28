import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { colorizeRadarGrid, downsampleRadarGrid, type DecodedRadarGrid } from '../src/meteofrance/radar';

function buildGrid(overrides: Partial<DecodedRadarGrid> = {}): DecodedRadarGrid {
  return {
    width: 2,
    height: 2,
    values: new Uint16Array([0, 500, 65534, 65535]),
    gain: 0.01,
    offset: 0,
    nodata: 65535,
    undetect: 65534,
    validTime: '2026-08-28T16:30:00Z',
    corners: {
      ul: [53.67, -9.965],
      ur: [52.548, 17.564],
      ll: [38.145, -6.715],
      lr: [37.457, 11.976],
    },
    ...overrides,
  };
}

describe('downsampleRadarGrid', () => {
  it('ne modifie pas la grille si elle tient deja dans la dimension maximale', () => {
    const grid = buildGrid();
    expect(downsampleRadarGrid(grid, 1200)).toBe(grid);
  });

  it('sous-echantillonne par pas fixe en conservant le ratio d aspect', () => {
    const grid = buildGrid({
      width: 4,
      height: 4,
      values: new Uint16Array([
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16,
      ]),
    });

    const result = downsampleRadarGrid(grid, 2);

    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Array.from(result.values)).toEqual([1, 3, 9, 11]);
    expect(result.corners).toBe(grid.corners);
  });
});

describe('colorizeRadarGrid', () => {
  it('rend transparent les pixels nodata/undetect et sous le seuil de pluie', () => {
    const grid = buildGrid({ values: new Uint16Array([0, 5, 65534, 65535]) });
    const png = PNG.sync.read(colorizeRadarGrid(grid));

    expect(png.data[3]).toBe(0);
    expect(png.data[4 + 3]).toBe(0);
    expect(png.data[8 + 3]).toBe(0);
    expect(png.data[12 + 3]).toBe(0);
  });

  it('colorise les pixels de pluie avec un canal alpha opaque', () => {
    const grid = buildGrid({ width: 1, height: 1, values: new Uint16Array([2000]) });
    const png = PNG.sync.read(colorizeRadarGrid(grid));

    expect(png.data[3]).toBe(255);
    expect(png.data[0]).toBeGreaterThan(0);
  });
});
