import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpMeteoFranceClient,
  buildAromeCoverageId,
  buildAromeGetCoverageUrl,
  parseVigilanceCarte,
} from '../src/meteofrance/client';
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

describe('parseVigilanceCarte', () => {
  it('parse une carte vigilance en Vigilance par departement', () => {
    const raw = {
      periods: [
        {
          echeance: 'J',
          timelaps: {
            domain_ids: [
              {
                domain_id: '75',
                max_color_id: '3',
                phenomenon_max_colors: [
                  { phenomenon_id: '1', phenomenon_max_color_id: '3' },
                  { phenomenon_id: '2', phenomenon_max_color_id: '1' },
                ],
              },
              { domain_id: '13', max_color_id: '1' },
            ],
          },
        },
      ],
    };

    const result = parseVigilanceCarte(raw, '2026-08-28T10:00:00.000Z');

    expect(result['75']).toEqual({
      fetchedAt: '2026-08-28T10:00:00.000Z',
      departement: '75',
      color: 'orange',
      risks: ['vent'],
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

  it('echange l APPLICATION_ID contre un access_token puis l utilise en Bearer', async () => {
    const env = buildTestEnv();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === env.METEOFRANCE_TOKEN_URL) {
        return Promise.resolve(jsonResponse({ access_token: 'token-1', expires_in: 3600 }));
      }
      return Promise.resolve(jsonResponse({ periods: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpMeteoFranceClient(env, logger);
    await client.getVigilanceMap();

    const tokenCall = fetchMock.mock.calls.find(([input]) => String(input) === env.METEOFRANCE_TOKEN_URL);
    expect(tokenCall?.[1]?.headers).toMatchObject({
      Authorization: `Basic ${env.METEOFRANCE_APPLICATION_ID}`,
    });

    const dataCall = fetchMock.mock.calls.find(([input]) => String(input) !== env.METEOFRANCE_TOKEN_URL);
    expect(dataCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });

  it('deduplique les refresh de token concurrents', async () => {
    const env = buildTestEnv();
    let tokenCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === env.METEOFRANCE_TOKEN_URL) {
        tokenCalls++;
        return Promise.resolve(jsonResponse({ access_token: `token-${tokenCalls}`, expires_in: 3600 }));
      }
      return Promise.resolve(jsonResponse({ periods: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpMeteoFranceClient(env, logger);
    await Promise.all([client.getVigilanceMap(), client.getVigilanceMap(), client.getVigilanceMap()]);

    expect(tokenCalls).toBe(1);
  });
});
