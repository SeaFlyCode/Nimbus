import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpMeteoFranceClient,
  buildAromeCoverageId,
  buildAromeGetCoverageUrl,
  buildRadarProduitUrl,
  parseVigilanceCarte,
} from '../src/meteofrance/client';
import * as radar from '../src/meteofrance/radar';
import { buildTestEnv } from './support/testEnv';

const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as any;

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('buildAromeGetCoverageUrl', () => {
  it('construit une URL GetCoverage WCS avec le bbox et le coverageId attendus', () => {
    const { url, coverageId } = buildAromeGetCoverageUrl('https://public-api.meteofrance.fr', 'TEMPERATURE', 3);

    expect(url.pathname).toBe('/public/arome/1.0/wcs/MF-NWP-HIGHRES-AROME-001-FRANCE-WCS/GetCoverage');
    expect(url.searchParams.get('service')).toBe('WCS');
    expect(url.searchParams.get('coverageId')).toBe(coverageId);
    expect(url.searchParams.getAll('subset')).toEqual([
      'Long(-5.5,10)',
      'Lat(41,51.5)',
    ]);
  });

  it('genere un coverageId sans caractere ":" (incompatible avec la nomenclature WCS)', () => {
    const id = buildAromeCoverageId('WIND_SPEED', '2026-08-28T13:00:00.000Z');
    expect(id).toBe('WIND_SPEED__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___10_M___2026-08-28T13.00.00.000Z');
  });
});

describe('buildRadarProduitUrl', () => {
  it('cible la zone METROPOLE, l observation LAME_D_EAU et la maille 500m', () => {
    const url = buildRadarProduitUrl('https://public-api.meteofrance.fr');

    expect(url.pathname).toBe('/public/DPRadar/v1/mosaiques/METROPOLE/observations/LAME_D_EAU/produit');
    expect(url.searchParams.get('maille')).toBe('500');
  });
});

describe('parseVigilanceCarte', () => {
  // Forme reelle confirmee sur un compte actif le 2026-08-28 (reponse enveloppee dans
  // "product", couleurs numeriques, phenomenes sous "phenomenon_items").
  it('parse une carte vigilance en Vigilance par departement', () => {
    const raw = {
      product: {
        periods: [
          {
            echeance: 'J',
            timelaps: {
              domain_ids: [
                {
                  domain_id: '75',
                  max_color_id: 2,
                  phenomenon_items: [
                    { phenomenon_id: '3', phenomenon_max_color_id: 2 },
                    { phenomenon_id: '1', phenomenon_max_color_id: 1 },
                  ],
                },
                { domain_id: '13', max_color_id: 1 },
              ],
            },
          },
        ],
      },
    };

    const result = parseVigilanceCarte(raw, '2026-08-28T10:00:00.000Z');

    expect(result['75']).toEqual({
      fetchedAt: '2026-08-28T10:00:00.000Z',
      departement: '75',
      color: 'jaune',
      risks: ['orages'],
    });
    expect(result['13'].color).toBe('vert');
    expect(result['13'].risks).toEqual([]);
  });

  it('renvoie un objet vide sur une reponse sans periode', () => {
    expect(parseVigilanceCarte({}, '2026-08-28T10:00:00.000Z')).toEqual({});
  });
});

describe('HttpMeteoFranceClient auth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Le portail WSO2 transmet la cle self-service via le header "apikey", pas
  // "Authorization: Bearer" (confirme empiriquement : Bearer renvoie 401 avec la meme cle).
  it('transmet la cle via le header apikey', async () => {
    const env = buildTestEnv();
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ product: { periods: [] } })));
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpMeteoFranceClient(env, logger);
    await client.getVigilanceMap();

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      apikey: env.METEOFRANCE_API_KEY,
    });
  });
});

describe('HttpMeteoFranceClient.getRadarMosaic', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Le vrai decodage HDF5/colorisation PNG est teste separement (tests/radar.test.ts) : ici on
  // verifie uniquement l'orchestration (fetch -> decode -> downsample -> colorize -> mosaic).
  it('orchestre fetch, decodage HDF5 et colorisation sans appeler le reseau/HDF5 reels', async () => {
    const env = buildTestEnv();
    const buffer = new ArrayBuffer(8);
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(buffer, { status: 200, headers: { 'Content-Type': 'application/x-hdf' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const decodedGrid = {
      width: 2,
      height: 2,
      values: new Uint16Array([0, 0, 0, 0]),
      gain: 0.01,
      offset: 0,
      nodata: 65535,
      undetect: 65534,
      validTime: '2026-08-28T16:30:00Z',
      corners: {
        ul: [53.67, -9.965] as [number, number],
        ur: [52.548, 17.564] as [number, number],
        ll: [38.145, -6.715] as [number, number],
        lr: [37.457, 11.976] as [number, number],
      },
    };
    vi.spyOn(radar, 'decodeRadarHdf5').mockResolvedValue(decodedGrid);
    vi.spyOn(radar, 'downsampleRadarGrid').mockReturnValue(decodedGrid);
    vi.spyOn(radar, 'colorizeRadarGrid').mockReturnValue(Buffer.from('fake-png'));

    const client = new HttpMeteoFranceClient(env, logger);
    const mosaic = await client.getRadarMosaic();

    expect(fetchMock.mock.calls[0][0].toString()).toContain(
      '/public/DPRadar/v1/mosaiques/METROPOLE/observations/LAME_D_EAU/produit',
    );
    expect(mosaic.validTime).toBe(decodedGrid.validTime);
    expect(mosaic.corners).toEqual(decodedGrid.corners);
    expect(mosaic.imageBase64).toBe(Buffer.from('fake-png').toString('base64'));
  });
});
