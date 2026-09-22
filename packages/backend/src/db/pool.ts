import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import type { Config } from '../config/config';

/**
 * The one and only `mysql2` pool for the process. No module outside this file imports
 * `mysql2` directly — repositories call `getPool()` after `initPool()` has run once at
 * startup (see `src/server.ts`).
 */
let pool: Pool | undefined;

export function initPool(config: Config): Pool {
  pool = mysql.createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    // Hibiscus's `datum`/`valuta`/`saldo_datum` columns are DATE/DATETIME; return them as
    // plain strings instead of JS Date objects so the API's JSON output isn't subject to
    // local-timezone conversion on the way out.
    dateStrings: true,
  });
  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('DB pool not initialized — call initPool() at startup before using it');
  }
  return pool;
}
