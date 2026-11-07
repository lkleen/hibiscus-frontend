import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/pool';

interface UserSettingRow extends RowDataPacket {
  value: string;
}

export interface UserSettingWrite {
  user: string;
  key: string;
  value: unknown;
}

/** Per-user settings (`hf_user_setting`), values stored as JSON. */
export interface UserSettingRepository {
  /** The parsed value; `undefined` only when the key is not set. */
  get(user: string, key: string): Promise<unknown | undefined>;
  /** Inserts or replaces the value atomically. */
  put(params: UserSettingWrite): Promise<void>;
  /** Removes the value; nothing happens when it is not set. */
  delete(user: string, key: string): Promise<void>;
}

/**
 * Create the `hf_user_setting` table if it doesn't exist. This is an app-owned table
 * (prefix `hf_` keeps it clear of Hibiscus's own schema) for persisting per-user settings.
 */
export async function ensureUserSettingTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hf_user_setting (
      user_name VARCHAR(255) NOT NULL,
      setting_key VARCHAR(64) NOT NULL,
      value LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_name, setting_key)
    ) DEFAULT CHARSET=utf8mb4
  `);
}

/** `UserSettingRepository` on the user's Hibiscus MariaDB. */
export class MysqlUserSettingRepository implements UserSettingRepository {
  /**
   * Retrieve a user setting by key. Returns `undefined` only when no row exists for that key
   * (a legitimate "not set" state, not a failure). The value is JSON.parse'd.
   */
  async get(user: string, key: string): Promise<unknown | undefined> {
    const pool = getPool();
    const [rows] = await pool.query<UserSettingRow[]>(
      `SELECT value FROM hf_user_setting WHERE user_name = ? AND setting_key = ?`,
      [user, key],
    );
    if (rows.length === 0) {
      return undefined;
    }
    return JSON.parse(rows[0].value);
  }

  /**
   * Insert or update a user setting. Uses `INSERT ... ON DUPLICATE KEY UPDATE`, which is atomic
   * and prevents concurrent saves from creating duplicate rows. The value is JSON.stringify'd.
   */
  async put(params: UserSettingWrite): Promise<void> {
    const pool = getPool();
    const jsonValue: string = JSON.stringify(params.value);
    await pool.query(
      `INSERT INTO hf_user_setting (user_name, setting_key, value) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [params.user, params.key, jsonValue],
    );
  }

  /**
   * Delete a user setting. Does nothing if the key doesn't exist for that user.
   */
  async delete(user: string, key: string): Promise<void> {
    const pool = getPool();
    await pool.query(`DELETE FROM hf_user_setting WHERE user_name = ? AND setting_key = ?`, [
      user,
      key,
    ]);
  }
}
