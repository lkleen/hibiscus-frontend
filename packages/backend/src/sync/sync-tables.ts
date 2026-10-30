import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/pool';

interface NullableRow extends RowDataPacket {
  nullable: string;
}

/**
 * Tables created before 2.0.0 had `NOT NULL` PIN columns; a key reset needs them nullable. Altered
 * only when needed, so an up-to-date table is never rebuilt.
 */
async function makePinColumnsNullable(pool: Pool): Promise<void> {
  const [rows] = await pool.query<NullableRow[]>(
    `SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hf_bank_connection'
       AND COLUMN_NAME = 'pin_ciphertext'`,
  );
  if (rows[0]?.nullable !== 'NO') return;
  await pool.query(`
    ALTER TABLE hf_bank_connection
      MODIFY pin_ciphertext VARBINARY(512) NULL,
      MODIFY pin_iv BINARY(12) NULL,
      MODIFY pin_tag BINARY(16) NULL
  `);
}

/**
 * Create the app-owned bank sync tables (prefix `hf_`, clear of Hibiscus's own schema) if they do
 * not exist yet. Hibiscus's own tables are never altered.
 *
 * - `hf_bank_connection`: one FinTS login. The PIN is stored AES-256-GCM encrypted with the user's
 *   own key in the three `pin_*` columns (see `user-keys.ts`); they are `NULL` after a key reset. `banking_information` is lib-fints's bank and
 *   user parameter data as JSON, reused so a dialog needs no new synchronization.
 * - `hf_bank_connection_account`: maps a FinTS account (IBAN or account number) to a `konto`.
 *   Removed with its connection or its konto.
 * - `hf_sync_run`: one row per run, removed with its connection.
 */
export async function ensureSyncTables(): Promise<void> {
  const pool: Pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hf_bank_connection (
      id INT(10) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      blz VARCHAR(8) NOT NULL,
      fints_url VARCHAR(255) NOT NULL,
      login_name VARCHAR(100) NOT NULL,
      customer_id VARCHAR(100) NULL,
      pin_ciphertext VARBINARY(512) NULL,
      pin_iv BINARY(12) NULL,
      pin_tag BINARY(16) NULL,
      tan_method INT NULL,
      tan_media VARCHAR(100) NULL,
      banking_information LONGTEXT NULL,
      sync_interval_hours INT NOT NULL DEFAULT 6,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      paused_reason VARCHAR(16) NULL,
      last_sync_at DATETIME NULL,
      last_status VARCHAR(16) NULL,
      last_error TEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await makePinColumnsNullable(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hf_bank_connection_account (
      connection_id INT(10) NOT NULL,
      account_identifier VARCHAR(64) NOT NULL,
      konto_id INT(10) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (connection_id, account_identifier),
      CONSTRAINT fk_hf_bca_connection FOREIGN KEY (connection_id) REFERENCES hf_bank_connection (id) ON DELETE CASCADE,
      CONSTRAINT fk_hf_bca_konto FOREIGN KEY (konto_id) REFERENCES konto (id) ON UPDATE CASCADE ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hf_sync_run (
      id INT(10) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      connection_id INT(10) NOT NULL,
      trigger_type ENUM('scheduled', 'manual', 'discover') NOT NULL,
      started_at DATETIME NOT NULL,
      finished_at DATETIME NULL,
      status ENUM('running', 'tan_required', 'success', 'error', 'tan_expired') NOT NULL,
      error TEXT NULL,
      inserted INT NOT NULL DEFAULT 0,
      deleted INT NOT NULL DEFAULT 0,
      KEY idx_hf_sync_run_connection (connection_id, id),
      CONSTRAINT fk_hf_sync_run_connection FOREIGN KEY (connection_id) REFERENCES hf_bank_connection (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
