import { z } from 'zod';

/** One `ALLOWED_DB_HOSTS` entry. `port: null` allows every port of the host. */
export interface AllowedDbHost {
  /** Lower-cased; matched case-insensitively. */
  readonly host: string;
  readonly port: number | null;
}

/** The host and port a database connection goes to. */
export interface DbHostTarget {
  readonly host: string;
  readonly port: number;
}

const AllowedDbHostSchema = z
  .string()
  .regex(/^[^:\s]+(:\d{1,5})?$/, 'ALLOWED_DB_HOSTS entries must be `host` or `host:port`')
  .transform((entry: string): AllowedDbHost => {
    const [host, port] = entry.split(':');
    if (host === undefined) throw new Error(`Unparsable ALLOWED_DB_HOSTS entry: ${entry}`);
    return { host: host.toLowerCase(), port: port === undefined ? null : Number(port) };
  })
  .refine(
    (entry: AllowedDbHost): boolean =>
      entry.port === null || (entry.port >= 1 && entry.port <= 65535),
    'ALLOWED_DB_HOSTS ports must be between 1 and 65535',
  );

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
  /** `DB_*`: the app database. It holds only `hf_app_user`; each user's data is elsewhere. */
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
  /**
   * The database hosts users may point their Hibiscus database at: comma-separated `host` or
   * `host:port`. Checked when the settings are saved and again before every pool is created.
   */
  ALLOWED_DB_HOSTS: z
    .string()
    .min(1, 'ALLOWED_DB_HOSTS is required')
    .transform((value: string): string[] =>
      value
        .split(',')
        .map((entry: string): string => entry.trim())
        .filter((entry: string): boolean => entry.length > 0),
    )
    .pipe(z.array(AllowedDbHostSchema).min(1, 'ALLOWED_DB_HOSTS must contain at least one host')),
  /**
   * The server key (AES-256-GCM) that encrypts the bank PINs at rest: base64 of exactly 32 bytes
   * (`openssl rand -base64 32`). Losing it means re-entering every PIN.
   */
  BANK_CREDENTIALS_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'BANK_CREDENTIALS_KEY must be base64')
    .transform((value: string): Buffer => Buffer.from(value, 'base64'))
    .refine(
      (key: Buffer): boolean => key.length === 32,
      'BANK_CREDENTIALS_KEY must decode to exactly 32 bytes',
    ),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Exact match on the host (case-insensitive), and on the port when the entry names one. */
export function isDbHostAllowed(allowed: readonly AllowedDbHost[], target: DbHostTarget): boolean {
  const host: string = target.host.toLowerCase();
  return allowed.some(
    (entry: AllowedDbHost): boolean =>
      entry.host === host && (entry.port === null || entry.port === target.port),
  );
}

/** An entry as the operator wrote it (lower-cased): `host` or `host:port`. */
export function formatAllowedDbHost(entry: AllowedDbHost): string {
  return entry.port === null ? entry.host : `${entry.host}:${entry.port}`;
}

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
