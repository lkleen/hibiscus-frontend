import { AsyncLocalStorage } from 'node:async_hooks';
import mysql from 'mysql2/promise';
import type { Connection, Pool, RowDataPacket } from 'mysql2/promise';
import type {
  UserDatabaseSettings,
  UserDatabaseTestResponse,
} from '@hibiscus-frontend/shared/contracts/user';
import type { Config } from '../config/config';

/**
 * Every `mysql2` pool and connection of the process is created in this file; no other module
 * imports `mysql2` at runtime.
 *
 * - The **app pool** (`DB_*`, `initAppPool()` at startup, `getAppPool()`) holds only
 *   `hf_app_user`.
 * - Each user works on **their own Hibiscus database**. `getPool()` returns the pool of the user
 *   the current request (or scheduled run) belongs to, from an `AsyncLocalStorage` context that
 *   `runWithUserContext` sets — so the repositories keep calling `getPool()` unchanged.
 */

/** A user's database, as the context carries it. */
export interface UserDatabaseHandle {
  readonly pool: Pool;
  readonly settings: UserDatabaseSettings;
}

/** Who the current work belongs to; `database: null` while the user has none set up. */
export interface UserContext {
  readonly user: string;
  readonly database: UserDatabaseHandle | null;
}

/** Connection details including the plaintext password; never logged or returned. */
export interface DatabaseTarget extends UserDatabaseSettings {
  readonly password: string;
}

/** `getPool()` was called for a user who has not set up their Hibiscus database. */
export class DatabaseNotConfiguredError extends Error {
  constructor(readonly user: string) {
    super(`The user ${user} has no Hibiscus database configured`);
    this.name = 'DatabaseNotConfiguredError';
  }
}

const USER_POOL_CONNECTION_LIMIT = 5;
const APP_POOL_CONNECTION_LIMIT = 10;
const TEST_TIMEOUT_MS = 5000;
/** The Hibiscus tables the app cannot work without. */
const HIBISCUS_TABLES: readonly string[] = ['konto', 'umsatz'];

const userContext: AsyncLocalStorage<UserContext> = new AsyncLocalStorage<UserContext>();
let appPool: Pool | undefined;

function createPool(target: DatabaseTarget, connectionLimit: number): Pool {
  return mysql.createPool({
    host: target.host,
    port: target.port,
    database: target.name,
    user: target.user,
    password: target.password,
    waitForConnections: true,
    connectionLimit,
    // Hibiscus's `datum`/`valuta`/`saldo_datum` columns are DATE/DATETIME; return them as
    // plain strings instead of JS Date objects so the API's JSON output isn't subject to
    // local-timezone conversion on the way out.
    dateStrings: true,
  });
}

/** Creates the app pool from `DB_*`; once, at startup. */
export function initAppPool(config: Config): Pool {
  if (appPool !== undefined) throw new Error('The app DB pool is already initialized');
  appPool = createPool(
    {
      host: config.DB_HOST,
      port: config.DB_PORT,
      name: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
    },
    APP_POOL_CONNECTION_LIMIT,
  );
  return appPool;
}

/** The app database (`DB_*`), for `hf_app_user` only. */
export function getAppPool(): Pool {
  if (appPool === undefined) {
    throw new Error('App DB pool not initialized — call initAppPool() at startup before using it');
  }
  return appPool;
}

/** A pool on a user's Hibiscus database; `user-pools.ts` owns and caches these. */
export function createUserDatabasePool(target: DatabaseTarget): Pool {
  return createPool(target, USER_POOL_CONNECTION_LIMIT);
}

/** Runs `fn` — and everything it awaits or starts — as work of `context.user`. */
export function runWithUserContext<T>(context: UserContext, fn: () => T): T {
  return userContext.run(context, fn);
}

/** The current context; throws outside of any (a bug: every caller runs inside one). */
export function currentUser(): UserContext {
  const context: UserContext | undefined = userContext.getStore();
  if (context === undefined) {
    throw new Error('No user context — database work must run inside runWithUserContext()');
  }
  return context;
}

/** The current user's database; throws `DatabaseNotConfiguredError` when there is none. */
export function currentDatabase(): UserDatabaseHandle {
  const context: UserContext = currentUser();
  if (context.database === null) throw new DatabaseNotConfiguredError(context.user);
  return context.database;
}

/** The current user's Hibiscus database pool. */
export function getPool(): Pool {
  return currentDatabase().pool;
}

interface TableNameRow extends RowDataPacket {
  name: string;
}

/** Replaces every occurrence of the password, so no error text can carry it. */
export function withoutPassword(message: string, password: string): string {
  return password.length === 0 ? message : message.split(password).join('***');
}

/**
 * Connects once, with a short timeout, and checks that Hibiscus's tables exist. A failure is the
 * result (`ok: false` with the reason), not an exception; the reason never contains the password.
 */
export async function testDatabaseConnection(
  target: DatabaseTarget,
): Promise<UserDatabaseTestResponse> {
  let connection: Connection | undefined;
  try {
    connection = await mysql.createConnection({
      host: target.host,
      port: target.port,
      database: target.name,
      user: target.user,
      password: target.password,
      connectTimeout: TEST_TIMEOUT_MS,
    });
    const [rows] = await connection.query<TableNameRow[]>({
      sql: `SELECT TABLE_NAME AS name FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
      values: [HIBISCUS_TABLES],
      timeout: TEST_TIMEOUT_MS,
    });
    const found: Set<string> = new Set<string>(rows.map((row: TableNameRow): string => row.name));
    const hibiscusSchema: boolean = HIBISCUS_TABLES.every((table: string): boolean =>
      found.has(table),
    );
    return { ok: true, hibiscusSchema, error: null };
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    return { ok: false, hibiscusSchema: false, error: withoutPassword(message, target.password) };
  } finally {
    // `destroy` closes without a round trip, so a broken connection cannot hang or throw here.
    connection?.destroy();
  }
}
