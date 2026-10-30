import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import { ensureSyncTables } from './sync-tables';

describe('ensureSyncTables', () => {
  it('creates the three tables if missing, with the foreign keys', async () => {
    const pool: { query: ReturnType<typeof vi.fn> } = { query: vi.fn().mockResolvedValue([{}]) };
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);

    await ensureSyncTables();

    const sql: string[] = (pool.query.mock.calls as [string][]).map(([s]: [string]) =>
      s.replace(/\s+/g, ' '),
    );
    expect(sql).toHaveLength(3);
    expect(sql[0]).toContain('CREATE TABLE IF NOT EXISTS hf_bank_connection (');
    expect(sql[0]).toContain('sync_interval_hours INT NOT NULL DEFAULT 6');
    expect(sql[1]).toContain('CREATE TABLE IF NOT EXISTS hf_bank_connection_account');
    expect(sql[1]).toContain('REFERENCES konto (id)');
    expect(sql[2]).toContain('CREATE TABLE IF NOT EXISTS hf_sync_run');
    expect(sql[2]).toContain("ENUM('running', 'tan_required', 'success', 'error', 'tan_expired')");
  });
});
