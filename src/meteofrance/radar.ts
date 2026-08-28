import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { H5Dataset, H5Group } from 'h5wasm/node';

export interface RadarCorners {
  ul: [number, number];
  ur: [number, number];
  ll: [number, number];
  lr: [number, number];
}

export interface DecodedRadarGrid {
  width: number;
  height: number;
  values: Uint16Array;
  gain: number;
  offset: number;
  nodata: number;
  undetect: number;
  corners: RadarCorners;
  validTime: string;
}

function formatValidTime(date: string, time: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
}

// h5wasm est un package ESM pur (aucune condition "require" dans son package.json) : avec
// une cible de compilation CommonJS, tsc reecrit un `await import(...)` statique en
// `require(...)`, ce qui echoue au runtime (ERR_PACKAGE_PATH_NOT_EXPORTED). Le detour par
// `new Function` masque l'appel a l'analyse statique de tsc et force un vrai import() dynamique.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('h5wasm/node')>;

// h5wasm/node s'appuie sur NODERAWFS (systeme de fichiers hote reel) : pas d'API pour ouvrir
// directement un buffer memoire, il faut passer par un fichier temporaire reel.
export async function decodeRadarHdf5(buffer: ArrayBuffer): Promise<DecodedRadarGrid> {
  const h5wasm = await dynamicImport('h5wasm/node');
  await h5wasm.ready;

  const dir = await mkdtemp(join(tmpdir(), 'nimbus-radar-'));
  const filePath = join(dir, `${randomUUID()}.h5`);

  try {
    await writeFile(filePath, Buffer.from(buffer));
    const file = new h5wasm.File(filePath, 'r');
    try {
      const where = file.get('where') as H5Group;
      const attr = (name: string): number => Number(where.attrs[name].value);

      const datasetWhat = file.get('dataset1/what') as H5Group;
      const validTime = formatValidTime(
        String(datasetWhat.attrs.enddate.value),
        String(datasetWhat.attrs.endtime.value),
      );

      const dataWhat = file.get('dataset1/data1/what') as H5Group;
      const gain = Number(dataWhat.attrs.gain.value);
      const offset = Number(dataWhat.attrs.offset.value);
      const nodata = Number(dataWhat.attrs.nodata.value);
      const undetect = Number(dataWhat.attrs.undetect.value);

      const dataset = file.get('dataset1/data1/data') as H5Dataset;
      const [height, width] = dataset.shape;

      return {
        width,
        height,
        values: dataset.value,
        gain,
        offset,
        nodata,
        undetect,
        validTime,
        corners: {
          ul: [attr('UL_lat'), attr('UL_lon')],
          ur: [attr('UR_lat'), attr('UR_lon')],
          ll: [attr('LL_lat'), attr('LL_lon')],
          lr: [attr('LR_lat'), attr('LR_lon')],
        },
      };
    } finally {
      file.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function downsampleRadarGrid(grid: DecodedRadarGrid, maxDimension: number): DecodedRadarGrid {
  const stride = Math.max(1, Math.ceil(Math.max(grid.width, grid.height) / maxDimension));
  if (stride === 1) return grid;

  const width = Math.ceil(grid.width / stride);
  const height = Math.ceil(grid.height / stride);
  const values = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values[y * width + x] = grid.values[y * stride * grid.width + x * stride];
    }
  }

  return { ...grid, width, height, values };
}

// Palette d'intensite de pluie standard (bleu clair -> vert -> jaune -> orange -> rouge -> violet),
// interpolee lineairement entre paliers pour un degrade lisse. Sous ~0.1mm : transparent.
const RAIN_COLOR_STOPS: Array<{ mm: number; rgb: [number, number, number] }> = [
  { mm: 0.1, rgb: [120, 190, 255] },
  { mm: 1, rgb: [50, 130, 255] },
  { mm: 4, rgb: [40, 200, 80] },
  { mm: 10, rgb: [255, 230, 0] },
  { mm: 20, rgb: [255, 140, 0] },
  { mm: 40, rgb: [220, 30, 30] },
  { mm: 80, rgb: [170, 30, 170] },
];

function colorForRainMm(mm: number): [number, number, number] {
  if (mm <= RAIN_COLOR_STOPS[0].mm) return RAIN_COLOR_STOPS[0].rgb;
  for (let i = 1; i < RAIN_COLOR_STOPS.length; i++) {
    const prev = RAIN_COLOR_STOPS[i - 1];
    const curr = RAIN_COLOR_STOPS[i];
    if (mm <= curr.mm) {
      const t = (mm - prev.mm) / (curr.mm - prev.mm);
      return [
        Math.round(prev.rgb[0] + (curr.rgb[0] - prev.rgb[0]) * t),
        Math.round(prev.rgb[1] + (curr.rgb[1] - prev.rgb[1]) * t),
        Math.round(prev.rgb[2] + (curr.rgb[2] - prev.rgb[2]) * t),
      ];
    }
  }
  return RAIN_COLOR_STOPS[RAIN_COLOR_STOPS.length - 1].rgb;
}

export function colorizeRadarGrid(grid: DecodedRadarGrid): Buffer {
  const png = new PNG({ width: grid.width, height: grid.height });

  for (let i = 0; i < grid.values.length; i++) {
    const raw = grid.values[i];
    const idx = i * 4;

    if (raw === grid.nodata || raw === grid.undetect) {
      png.data[idx + 3] = 0;
      continue;
    }

    const mm = raw * grid.gain + grid.offset;
    if (mm < RAIN_COLOR_STOPS[0].mm) {
      png.data[idx + 3] = 0;
      continue;
    }

    const [r, g, b] = colorForRainMm(mm);
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = 255;
  }

  return PNG.sync.write(png);
}
