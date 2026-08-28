import type { HourlyForecastEntry } from './client';

export interface Grid {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
  // Row-major, ligne 0 = bord nord (ordre standard d'un raster GeoTIFF).
  values: number[];
}

export interface ForecastHourCacheEntry {
  hourOffset: number;
  validTime: string;
  bbox: { west: number; south: number; east: number; north: number };
  width: number;
  height: number;
  temperatureC: number[];
  precipitationMm: number[];
  windKmh: number[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function bilinearInterpolate(grid: Grid, lat: number, lon: number): number {
  if (grid.width < 2 || grid.height < 2) return grid.values[0];

  const lonStep = (grid.east - grid.west) / (grid.width - 1);
  const latStep = (grid.north - grid.south) / (grid.height - 1);

  const xf = clamp((lon - grid.west) / lonStep, 0, grid.width - 1);
  const yf = clamp((grid.north - lat) / latStep, 0, grid.height - 1);

  const x0 = Math.floor(xf);
  const y0 = Math.floor(yf);
  const x1 = Math.min(x0 + 1, grid.width - 1);
  const y1 = Math.min(y0 + 1, grid.height - 1);
  const tx = xf - x0;
  const ty = yf - y0;

  const at = (x: number, y: number) => grid.values[y * grid.width + x];
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function interpolateHourlyEntry(
  entry: ForecastHourCacheEntry,
  lat: number,
  lon: number,
): HourlyForecastEntry {
  const gridOf = (values: number[]): Grid => ({ ...entry.bbox, width: entry.width, height: entry.height, values });

  const temperatureC = bilinearInterpolate(gridOf(entry.temperatureC), lat, lon);
  const rainMm = Math.max(0, bilinearInterpolate(gridOf(entry.precipitationMm), lat, lon));
  const windKmh = Math.max(0, bilinearInterpolate(gridOf(entry.windKmh), lat, lon));

  return {
    time: entry.validTime,
    temperatureC: round1(temperatureC),
    // TODO: AROME est un modele deterministe, il ne fournit pas de probabilite de pluie native
    // (contrairement a un modele d'ensemble type PEARP). Heuristique en attendant une vraie source.
    precipitationProbability: rainMm > 0.1 ? 100 : 0,
    rainMm: round1(rainMm),
    windKmh: round1(windKmh),
  };
}
