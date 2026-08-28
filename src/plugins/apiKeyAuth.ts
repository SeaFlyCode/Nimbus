import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../config/env';

declare module 'fastify' {
  interface FastifyRequest {
    clientName: string;
  }
}

const PUBLIC_EXACT_PATHS = new Set(['/health']);
const PUBLIC_PREFIXES = ['/docs'];

export function registerApiKeyAuth(app: FastifyInstance, env: Env): void {
  app.decorateRequest('clientName', '');

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url)) return;

    if (env.API_KEYS.size === 0) {
      request.clientName = 'anonymous';
      return;
    }

    const apiKey = request.headers['x-api-key'];
    const key = Array.isArray(apiKey) ? apiKey[0] : apiKey;

    if (!key || !env.API_KEYS.has(key)) {
      await reply.code(401).send({ error: 'Unauthorized', message: 'Cle API manquante ou invalide (header X-API-Key)' });
      return;
    }

    request.clientName = env.API_KEYS.get(key)!;
  });
}

function isPublicPath(url: string): boolean {
  const path = url.split('?')[0];
  return PUBLIC_EXACT_PATHS.has(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}
