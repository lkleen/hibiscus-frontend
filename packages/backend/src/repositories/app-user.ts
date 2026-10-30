import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { KeyMode, UserDatabaseSettings } from '@hibiscus-frontend/shared/contracts/user';
import { getAppPool } from '../db/pool';
import type { EncryptedSecret } from '../sync/credential-crypto';

/** A user's stored database settings; the password stays encrypted with the server key. */
export interface AppUserDatabaseRecord {
  readonly settings: UserDatabaseSettings;
  readonly password: EncryptedSecret;
  /** Raised on every save, so a cached pool of an older version is replaced. */
  readonly version: number;
}

export interface AppUserDatabaseWrite {
  readonly username: string;
  readonly settings: UserDatabaseSettings;
  readonly password: EncryptedSecret;
}

interface AppUserDatabaseRow extends RowDataPacket {
  db_host: string;
  db_port: number;
  db_name: string;
  db_user: string;
  db_password_ciphertext: Buffer;
  db_password_iv: Buffer;
  db_password_tag: Buffer;
  db_version: number;
}

/**
 * A user's key as stored: the mode, the HMAC check value, and — in `stored` mode only — the key
 * wrapped with the server key. The key itself is never stored in the clear.
 */
export interface AppUserKeyRecord {
  readonly mode: KeyMode;
  readonly check: Buffer;
  readonly wrapped: EncryptedSecret | null;
}

/** Parameters of `updateAppUserKey`: the row must still hold `expectedCheck`. */
export interface AppUserKeyUpdate {
  readonly expectedCheck: Buffer;
  readonly next: AppUserKeyRecord;
}

interface AppUserKeyRow extends RowDataPacket {
  key_mode: KeyMode | null;
  key_check: Buffer | null;
  key_wrapped_ciphertext: Buffer | null;
  key_wrapped_iv: Buffer | null;
  key_wrapped_tag: Buffer | null;
}

/** One Hibiscus database (host, port, name) belongs to one user: their stored key must fit its PINs. */
const DATABASE_UNIQUE_KEY = 'uq_hf_app_user_database';

interface UsernameRow extends RowDataPacket {
  username: string;
}

/**
 * Create the app-owned `hf_app_user` table in the app database (`DB_*`) if it does not exist: one
 * row per username the proxy asserts, nothing else about the user.
 *
 * - `db_*`: where the user's Hibiscus database is; the password is AES-256-GCM encrypted with the
 *   server key (`BANK_CREDENTIALS_KEY`). `db_version` is raised on every save. A unique key on
 *   (`db_host`, `db_port`, `db_name`) lets only one user use a Hibiscus database (users without a
 *   database have `NULL`s, which do not collide).
 * - `key_*`: the user's own key for the bank PINs (`key_mode`, the HMAC check value, and the key
 *   wrapped with the server key in `stored` mode).
 */
export async function ensureAppUserTable(): Promise<void> {
  await getAppPool().query(`
    CREATE TABLE IF NOT EXISTS hf_app_user (
      username VARCHAR(255) NOT NULL,
      db_host VARCHAR(255) NULL,
      db_port INT NULL,
      db_name VARCHAR(64) NULL,
      db_user VARCHAR(80) NULL,
      db_password_ciphertext VARBINARY(1024) NULL,
      db_password_iv VARBINARY(16) NULL,
      db_password_tag VARBINARY(16) NULL,
      db_version INT NOT NULL DEFAULT 0,
      key_mode ENUM('manual', 'memory', 'stored') NULL,
      key_check VARBINARY(32) NULL,
      key_wrapped_ciphertext VARBINARY(64) NULL,
      key_wrapped_iv VARBINARY(16) NULL,
      key_wrapped_tag VARBINARY(16) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (username),
      UNIQUE KEY ${DATABASE_UNIQUE_KEY} (db_host, db_port, db_name)
    ) DEFAULT CHARSET=utf8mb4
  `);
  await ensureDatabaseUniqueKey();
}

/**
 * Tables created before the one-user-per-database rule lack the unique key; it is added only when
 * missing. Fails (and so the startup) when two users already share a database.
 */
async function ensureDatabaseUniqueKey(): Promise<void> {
  const pool: Pool = getAppPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hf_app_user' AND INDEX_NAME = ?`,
    [DATABASE_UNIQUE_KEY],
  );
  if (rows.length > 0) return;
  await pool.query(
    `ALTER TABLE hf_app_user ADD UNIQUE KEY ${DATABASE_UNIQUE_KEY} (db_host, db_port, db_name)`,
  );
}

/** The user's database settings; `null` while the user has none. */
export async function getAppUserDatabase(username: string): Promise<AppUserDatabaseRecord | null> {
  const [rows] = await getAppPool().query<AppUserDatabaseRow[]>(
    `SELECT db_host, db_port, db_name, db_user, db_password_ciphertext, db_password_iv,
            db_password_tag, db_version
       FROM hf_app_user WHERE username = ? AND db_host IS NOT NULL`,
    [username],
  );
  const row: AppUserDatabaseRow | undefined = rows[0];
  if (row === undefined) return null;
  return {
    settings: { host: row.db_host, port: row.db_port, name: row.db_name, user: row.db_user },
    password: {
      ciphertext: row.db_password_ciphertext,
      iv: row.db_password_iv,
      tag: row.db_password_tag,
    },
    version: row.db_version,
  };
}

/**
 * Whether another user than `username` has the same database (host compared case-insensitively,
 * port, name). Only the friendly pre-check; the unique key decides under concurrency.
 */
export async function isDatabaseUsedByOther(
  username: string,
  settings: UserDatabaseSettings,
): Promise<boolean> {
  const [rows] = await getAppPool().query<UsernameRow[]>(
    `SELECT username FROM hf_app_user
      WHERE username <> ? AND LOWER(db_host) = ? AND db_port = ? AND db_name = ? LIMIT 1`,
    [username, settings.host.toLowerCase(), settings.port, settings.name],
  );
  return rows.length > 0;
}

/**
 * Saves the user's database settings (creating the row) and raises `db_version`. Throws the
 * `ER_DUP_ENTRY` error when another user has the same database (see `isDatabaseUsedByOther`). The
 * row is created first and then updated, so a clash with another user's database can never
 * overwrite that user's row (as `ON DUPLICATE KEY UPDATE` would).
 */
export async function saveAppUserDatabase(write: AppUserDatabaseWrite): Promise<void> {
  const { settings, password } = write;
  const pool: Pool = getAppPool();
  await pool.query('INSERT IGNORE INTO hf_app_user (username) VALUES (?)', [write.username]);
  await pool.query(
    `UPDATE hf_app_user SET db_host = ?, db_port = ?, db_name = ?, db_user = ?,
       db_password_ciphertext = ?, db_password_iv = ?, db_password_tag = ?,
       db_version = db_version + 1
     WHERE username = ?`,
    [
      settings.host,
      settings.port,
      settings.name,
      settings.user,
      password.ciphertext,
      password.iv,
      password.tag,
      write.username,
    ],
  );
}

/** Every user with a database set up, for the scheduler. */
export async function listAppUsersWithDatabase(): Promise<string[]> {
  const [rows] = await getAppPool().query<UsernameRow[]>(
    'SELECT username FROM hf_app_user WHERE db_host IS NOT NULL ORDER BY username',
  );
  return rows.map((row: UsernameRow): string => row.username);
}

/** The user's key record; `null` while no key is configured. */
export async function getAppUserKey(username: string): Promise<AppUserKeyRecord | null> {
  const [rows] = await getAppPool().query<AppUserKeyRow[]>(
    `SELECT key_mode, key_check, key_wrapped_ciphertext, key_wrapped_iv, key_wrapped_tag
       FROM hf_app_user WHERE username = ?`,
    [username],
  );
  const row: AppUserKeyRow | undefined = rows[0];
  if (row === undefined || row.key_mode === null) return null;
  if (row.key_check === null) throw new Error(`The key of ${username} has no check value`);
  const wrapped: EncryptedSecret | null =
    row.key_wrapped_ciphertext === null ||
    row.key_wrapped_iv === null ||
    row.key_wrapped_tag === null
      ? null
      : {
          ciphertext: row.key_wrapped_ciphertext,
          iv: row.key_wrapped_iv,
          tag: row.key_wrapped_tag,
        };
  return { mode: row.key_mode, check: row.key_check, wrapped };
}

/** The `SET` list and values that write a key record. */
function keyAssignments(record: AppUserKeyRecord): {
  sql: string;
  values: (string | Buffer | null)[];
} {
  return {
    sql: `key_mode = ?, key_check = ?, key_wrapped_ciphertext = ?, key_wrapped_iv = ?,
          key_wrapped_tag = ?`,
    values: [
      record.mode,
      record.check,
      record.wrapped?.ciphertext ?? null,
      record.wrapped?.iv ?? null,
      record.wrapped?.tag ?? null,
    ],
  };
}

/**
 * Sets the user's first key (creating the row when the user has none yet). `false` when a key is
 * configured already; the check and the write are one statement, so two creates cannot both win.
 */
export async function createAppUserKey(
  username: string,
  record: AppUserKeyRecord,
): Promise<boolean> {
  const pool: Pool = getAppPool();
  await pool.query('INSERT IGNORE INTO hf_app_user (username) VALUES (?)', [username]);
  const { sql, values } = keyAssignments(record);
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE hf_app_user SET ${sql} WHERE username = ? AND key_mode IS NULL`,
    [...values, username],
  );
  return result.affectedRows === 1;
}

/**
 * Replaces the user's key record if it still holds `expectedCheck`; throws when it does not (the
 * key was changed or reset meanwhile).
 */
export async function updateAppUserKey(username: string, update: AppUserKeyUpdate): Promise<void> {
  const { sql, values } = keyAssignments(update.next);
  const [result] = await getAppPool().query<ResultSetHeader>(
    `UPDATE hf_app_user SET ${sql} WHERE username = ? AND key_check = ?`,
    [...values, username, update.expectedCheck],
  );
  if (result.affectedRows !== 1) {
    throw new Error(`The key of ${username} changed while it was being updated`);
  }
}

/** Removes the user's key: mode, check value and wrapped copy. */
export async function deleteAppUserKey(username: string): Promise<void> {
  await getAppPool().query(
    `UPDATE hf_app_user SET key_mode = NULL, key_check = NULL, key_wrapped_ciphertext = NULL,
       key_wrapped_iv = NULL, key_wrapped_tag = NULL
     WHERE username = ?`,
    [username],
  );
}
