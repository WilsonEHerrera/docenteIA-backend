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
