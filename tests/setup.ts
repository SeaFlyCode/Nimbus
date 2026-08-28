import { vi } from 'vitest';
import { FakeRedis } from './support/fakeRedis';

vi.mock('ioredis', () => ({
  default: FakeRedis,
}));

// @fastify/rate-limit s'appuie sur des scripts Lua non supportes par le FakeRedis ;
// on le neutralise dans les tests, qui ne verifient pas le rate-limiting en tant que tel.
vi.mock('@fastify/rate-limit', () => ({
  default: async () => {},
}));
