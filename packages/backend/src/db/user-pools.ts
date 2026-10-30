import type { Pool } from 'mysql2/promise';
import type { UserDatabaseSettings } from '@hibiscus-frontend/shared/contracts/user';
import { isDbHostAllowed } from '../config/config';
import type { AllowedDbHost } from '../config/config';
import { getAppUserDatabase, listAppUsersWithDatabase } from '../repositories/app-user';
import type { AppUserDatabaseRecord } from '../repositories/app-user';
import { ensureTaxTagTables } from '../repositories/tax-tag';
import { ensureUserSettingTable } from '../repositories/user-setting';
import type { CredentialCrypto } from '../sync/credential-crypto';
import { ensureSyncTables } from '../sync/sync-tables';
import { createUserDatabasePool, runWithUserContext } from './pool';
import type { UserDatabaseHandle } from './pool';

/**
 * What `UserPools.acquire` found for a user:
 * - `configured` — the pool, with the app's `hf_*` tables ensured on it;
 * - `unconfigured` — no database set up yet;
 * - `host-not-allowed` — the stored host is no longer on `ALLOWED_DB_HOSTS`.
 */
export type UserDatabaseLookup =
  | { readonly status: 'configured'; readonly database: UserDatabaseHandle }
  | { readonly status: 'unconfigured' }
  | { readonly status: 'host-not-allowed' };

export interface UserPoolsOptions {
  /** The server key instance; decrypts the stored database passwords. */
  readonly crypto: CredentialCrypto;
  readonly allowedHosts: readonly AllowedDbHost[];
}

interface PoolEntry {
  readonly pool: Pool;
  readonly settings: UserDatabaseSettings;
  readonly version: number;
  /** The memoised table setup; reset to `null` when it fails, so the next request retries. */
  ensured: Promise<void> | null;
}

/** Creates the app-owned tables on a user's database; Hibiscus's own tables are never altered. */
async function ensureUserDatabaseTables(): Promise<void> {
  await ensureUserSettingTable();
  await ensureTaxTagTables();
  await ensureSyncTables();
}

/**
 * One lazily created pool per user, on that user's Hibiscus database.
 *
 * The cache key is the username, the entry carries `hf_app_user.db_version`: a save raises the
 * version, so the next lookup replaces the pool (and ends the old one). The entry is chosen and
 * stored synchronously after the row is read, so two concurrent first requests share one pool and
 * one table setup. A lookup that read an older row than the cached entry keeps the newer entry.
 */
export class UserPools {
  private readonly entries: Map<string, PoolEntry> = new Map<string, PoolEntry>();

  constructor(private readonly options: UserPoolsOptions) {}

  /** The user's database, ready to use; re-checks the allowlist before creating a pool. */
  async acquire(username: string): Promise<UserDatabaseLookup> {
    const record: AppUserDatabaseRecord | null = await getAppUserDatabase(username);
    if (record === null) return { status: 'unconfigured' };
    if (!isDbHostAllowed(this.options.allowedHosts, record.settings)) {
      console.warn(
        `[hibiscus-backend] The database host of ${username} is not on ALLOWED_DB_HOSTS any more`,
      );
      this.invalidate(username);
      return { status: 'host-not-allowed' };
    }
    const entry: PoolEntry = this.entryFor(username, record);
    await this.ensure(username, entry);
    return { status: 'configured', database: { pool: entry.pool, settings: entry.settings } };
  }

  /** Whether the user has a usable database set up; opens no pool. */
  async databaseStatus(username: string): Promise<'configured' | 'unconfigured'> {
    const record: AppUserDatabaseRecord | null = await getAppUserDatabase(username);
    return record !== null && isDbHostAllowed(this.options.allowedHosts, record.settings)
      ? 'configured'
      : 'unconfigured';
  }

  /** Every user with a database set up (allowlist not yet checked; `acquire` does that). */
  listUsersWithDatabase(): Promise<string[]> {
    return listAppUsersWithDatabase();
  }

  /** Drops and ends the user's pool, after the settings were saved. */
  invalidate(username: string): void {
    const entry: PoolEntry | undefined = this.entries.get(username);
    if (entry === undefined) return;
    this.entries.delete(username);
    this.end(username, entry);
  }

  private entryFor(username: string, record: AppUserDatabaseRecord): PoolEntry {
    const cached: PoolEntry | undefined = this.entries.get(username);
    if (cached !== undefined && cached.version >= record.version) return cached;
    if (cached !== undefined) this.end(username, cached);
    const entry: PoolEntry = {
      pool: createUserDatabasePool({
        ...record.settings,
        password: this.options.crypto.decrypt(record.password),
      }),
      settings: record.settings,
      version: record.version,
      ensured: null,
    };
    this.entries.set(username, entry);
    return entry;
  }

  private ensure(username: string, entry: PoolEntry): Promise<void> {
    if (entry.ensured !== null) return entry.ensured;
    const ensured: Promise<void> = runWithUserContext(
      { user: username, database: { pool: entry.pool, settings: entry.settings } },
      ensureUserDatabaseTables,
    );
    entry.ensured = ensured;
    // The caller gets the rejection; this only forgets it so the next lookup tries again.
    ensured.catch((): void => {
      if (entry.ensured === ensured) entry.ensured = null;
    });
    return ensured;
  }

  /** Ends a replaced pool in the background; this is the top level of that work, so it logs. */
  private end(username: string, entry: PoolEntry): void {
    entry.pool.end().catch((error: unknown): void => {
      console.error(
        `[hibiscus-backend] Ending the old database pool of ${username} failed:`,
        error,
      );
    });
  }
}
