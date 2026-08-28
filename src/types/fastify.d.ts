import type { Env } from '../config/env';
import type { MeteoFranceClient } from '../meteofrance/client';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    meteoClient: MeteoFranceClient;
  }
}
