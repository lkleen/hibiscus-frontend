import type { UserDatabaseHandle } from './pool';

/**
 * What `UserDatabases.acquire` found for a user:
 * - `configured` — the pool, with the app's `hf_*` tables ensured on it;
 * - `unconfigured` — no database set up yet;
 * - `host-not-allowed` — the stored host is no longer on `ALLOWED_DB_HOSTS`.
 */
export type UserDatabaseLookup =
  | { readonly status: 'configured'; readonly database: UserDatabaseHandle }
  | { readonly status: 'unconfigured' }
  | { readonly status: 'host-not-allowed' };

/**
 * Where each user's data lives: `UserPools` (one MySQL pool per user, on their own Hibiscus
 * database) or, with demo data, one fixed in-memory database. The middleware, `/api/me` and the
 * scheduler depend on this interface only.
 */
export interface UserDatabases {
  /** The user's database, ready to use, or why there is none. */
  acquire(username: string): Promise<UserDatabaseLookup>;
  /** Whether the user has a usable database set up; opens nothing. */
  databaseStatus(username: string): Promise<'configured' | 'unconfigured'>;
  /** Every user with a database set up (`acquire` still checks each). */
  listUsersWithDatabase(): Promise<string[]>;
  /** Forgets what is cached for the user, after their settings were saved. */
  invalidate(username: string): void;
}
