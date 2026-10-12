import { z } from 'zod';

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const positiveInt = (fallback: number) =>
  z.coerce.number().int().min(1).default(fallback);

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL es obligatoria'),
  CORS_ORIGINS: csv.default(['http://localhost:3000']),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TTL_SECONDS: positiveInt(900),
  REFRESH_TTL_DAYS: positiveInt(7),
  LOGIN_MAX_ATTEMPTS: positiveInt(5),
  LOCKOUT_MINUTES: positiveInt(15),
  AUTH_RATE_LIMIT_PER_MIN: positiveInt(10),
  RESET_TOKEN_TTL_MINUTES: positiveInt(30),
  ABSENCE_ALERT_THRESHOLD_PCT: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(80),
  // Only the deterministic Fake adapters exist for now.
  AI_PROVIDER: z.enum(['fake']).default('fake'),
  AI_TIMEOUT_MS: positiveInt(15000),
  // Total attempts per AI call (first try included).
  AI_MAX_RETRIES: positiveInt(3),
  // 0 = no daily limit.
  AI_DAILY_LIMIT_PER_INSTITUTION: z.coerce.number().int().min(0).default(500),
  FACE_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
  // 32 random bytes, base64. Without it, facial references cannot be stored.
  BIOMETRIC_ENCRYPTION_KEY: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'BIOMETRIC_ENCRYPTION_KEY debe ser de 32 bytes en base64',
      )
      .optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  return result.data;
}
