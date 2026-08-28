import { z } from 'zod';

const apiKeysSchema = z
  .string()
  .default('')
  .transform((raw, ctx) => {
    if (!raw.trim()) return new Map<string, string>();
    const entries = raw.split(',').map((pair) => pair.trim()).filter(Boolean);
    const map = new Map<string, string>();
    for (const entry of entries) {
      const [name, key] = entry.split(':').map((s) => s.trim());
      if (!name || !key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `API_KEYS entry invalide: "${entry}" (format attendu: nom:cle)`,
        });
        return z.NEVER;
      }
      map.set(key, name);
    }
    return map;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  METEOFRANCE_BASE_URL: z.string().url().default('https://portail-api.meteofrance.fr'),
  METEOFRANCE_TOKEN: z.string().min(1, 'METEOFRANCE_TOKEN est requis'),
  METEOFRANCE_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  METEOFRANCE_RETRY_COUNT: z.coerce.number().int().min(0).max(5).default(2),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  API_KEYS: apiKeysSchema,

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  RADAR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  FORECAST_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  ALERTS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  RADAR_HISTORY_MAX_ITEMS: z.coerce.number().int().positive().default(24),

  // Seuil de "degraded" = multiplicateur de l'intervalle de polling attendu.
  FRESHNESS_STALE_MULTIPLIER: z.coerce.number().positive().default(2),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide:\n${message}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}
