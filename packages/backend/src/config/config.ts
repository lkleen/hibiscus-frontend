import { z } from 'zod';

/**
 * All runtime configuration and secrets for this app. Built once, in this module, from
 * `process.env` — no other module reads `process.env` directly. Every field here is required:
 * a missing or invalid value is a startup failure (thrown below), never a silent default.
 *
 * Note: `INTERNAL_PROXY_SECRET` is validated here, but the *header name* it arrives on
 * (`X-Internal-Auth-Secret`) is intentionally not configurable — see
 * `src/middleware/auth.ts`'s `INTERNAL_AUTH_SECRET_HEADER` constant. Only the identity header's
 * name (`AUTH_HEADER_USER`) is configurable, per docs/architecture.md#authentication.
 */
const ConfigSchema = z.object({
  DB_HOST: z.string().min(1, 'DB_HOST is required'),
  DB_PORT: z.coerce.number().int().positive(),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  PORT: z.coerce.number().int().positive(),
  AUTH_HEADER_USER: z.string().min(1, 'AUTH_HEADER_USER is required'),
  ALLOWED_USERS: z
    .string()
    .min(1, 'ALLOWED_USERS is required')
    .transform((value: string): string[] =>
      value
        .split(',')
        .map((entry: string): string => entry.trim())
        .filter((entry: string): boolean => entry.length > 0),
    )
    .refine(
      (users: string[]): boolean => users.length > 0,
      'ALLOWED_USERS must contain at least one username after parsing',
    ),
  INTERNAL_PROXY_SECRET: z.string().min(1, 'INTERNAL_PROXY_SECRET is required'),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parses and validates `process.env` into a typed `Config`. Throws on the first missing or
 * invalid value — callers must not catch this to fall back to a default; a bad environment
 * should fail startup.
 */
export function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${result.error.toString()}`);
  }
  return result.data;
}
