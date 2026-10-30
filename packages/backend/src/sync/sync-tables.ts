import { getPool } from '../db/pool';

/**
 * Create the app-owned bank sync tables (prefix `hf_`, clear of Hibiscus's own schema) if they do
 * not exist yet. Hibiscus's own tables are never altered.
 *
 * - `hf_bank_connection`: one FinTS login. The PIN is stored AES-256-GCM encrypted in the three
 *   `pin_*` columns (see `credential-crypto.ts`). `banking_information` is lib-fints's bank and
 *   user parameter data as JSON, reused so a dialog needs no new synchronization.
 * - `hf_bank_connection_account`: maps a FinTS account (IBAN or account number) to a `konto`.
 *   Removed with its connection or its konto.
 * - `hf_sync_run`: one row per run, removed with its connection.
 */
export async function ensureSyncTables(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hf_bank_connection (
      id INT(10) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      blz VARCHAR(8) NOT NULL,
      fints_url VARCHAR(255) NOT NULL,
      login_name VARCHAR(100) NOT NULL,
      customer_id VARCHAR(100) NULL,
      pin_ciphertext VARBINARY(512) NOT NULL,
      pin_iv BINARY(12) NOT NULL,
      pin_tag BINARY(16) NOT NULL,
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
