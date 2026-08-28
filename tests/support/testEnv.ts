import { loadEnv, resetEnvCacheForTests, type Env } from '../../src/config/env';

const BASE = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  METEOFRANCE_APPLICATION_ID: 'dGVzdC1hcHBsaWNhdGlvbi1pZA==',
  METEOFRANCE_TOKEN_URL: 'https://portail-api.meteofrance.test/token',
  REDIS_URL: 'redis://localhost:6379',
  API_KEYS: '',
  RADAR_POLL_INTERVAL_MS: '300000',
  FORECAST_POLL_INTERVAL_MS: '900000',
  ALERTS_POLL_INTERVAL_MS: '900000',
  FRESHNESS_STALE_MULTIPLIER: '2',
};

export function buildTestEnv(overrides: Record<string, string> = {}): Env {
  resetEnvCacheForTests();
  return loadEnv({ ...BASE, ...overrides } as NodeJS.ProcessEnv);
}
