import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import { ensureSyncTables } from './sync-tables';

function queryResult(nullable: string): (sql: string) => Promise<unknown> {
  return async (sql: string) => (sql.includes('information_schema') ? [[{ nullable }]] : [{}]);
}

function statements(pool: { query: ReturnType<typeof vi.fn> }): string[] {
  return (pool.query.mock.calls as [string][]).map(([s]: [string]) => s.replace(/\s+/g, ' '));
}

describe('ensureSyncTables', () => {
  it('creates the three tables if missing, with the foreign keys', async () => {
    const pool: { query: ReturnType<typeof vi.fn> } = { query: vi.fn(queryResult('YES')) };
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);

    await ensureSyncTables();

    const sql: string[] = statements(pool);
    expect(sql).toHaveLength(4);
    expect(sql[0]).toContain('CREATE TABLE IF NOT EXISTS hf_bank_connection (');
    expect(sql[0]).toContain('sync_interval_hours INT NOT NULL DEFAULT 6');
    expect(sql[0]).toContain('pin_ciphertext VARBINARY(512) NULL');
    expect(sql[1]).toContain('information_schema.COLUMNS');
    expect(sql[2]).toContain('CREATE TABLE IF NOT EXISTS hf_bank_connection_account');
    expect(sql[2]).toContain('REFERENCES konto (id)');
    expect(sql[3]).toContain('CREATE TABLE IF NOT EXISTS hf_sync_run');
    expect(sql[3]).toContain("ENUM('running', 'tan_required', 'success', 'error', 'tan_expired')");
  });

  it('makes the PIN columns of an older table nullable', async () => {
    const pool: { query: ReturnType<typeof vi.fn> } = { query: vi.fn(queryResult('NO')) };
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);

    await ensureSyncTables();

    const sql: string[] = statements(pool);
    expect(sql).toHaveLength(5);
    expect(sql[2]).toContain('ALTER TABLE hf_bank_connection');
    expect(sql[2]).toContain('MODIFY pin_ciphertext VARBINARY(512) NULL');
    expect(sql[2]).toContain('MODIFY pin_tag BINARY(16) NULL');
  });
});
