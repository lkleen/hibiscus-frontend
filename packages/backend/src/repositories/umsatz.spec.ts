import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import { TRANSACTION_COLUMNS, listTransactions } from './umsatz';

interface FakePool {
  query: ReturnType<typeof vi.fn>;
}

function makeFakePool(): FakePool {
  return { query: vi.fn() };
}

describe('listTransactions', () => {
  let pool: FakePool;

  beforeEach(() => {
    pool = makeFakePool();
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
  });

  it('selects every row unfiltered and unpaged, as value arrays', async () => {
    pool.query.mockResolvedValueOnce([[]]);

    await listTransactions();

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [options] = pool.query.mock.calls[0] as [{ sql: string; rowsAsArray: boolean }];
    expect(options.rowsAsArray).toBe(true);
    expect(options.sql).toContain('FROM umsatz');
    expect(options.sql).not.toContain('WHERE');
    expect(options.sql).not.toContain('LIMIT');
  });

  it('selects exactly the response columns, in response order', async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const result = await listTransactions();

    const [options] = pool.query.mock.calls[0] as [{ sql: string }];
    expect(result.columns).toBe(TRANSACTION_COLUMNS);
    expect(options.sql).toContain(`SELECT ${TRANSACTION_COLUMNS.join(', ')} FROM umsatz`);
  });

  it('returns the rows exactly as the database delivered them', async () => {
    const rows: unknown[][] = [
      [2, 3, null, 'EREF+', -9],
      [1, 5, 'Shop', 'LASTSCHRIFT / BELASTUNG', 4],
    ];
    pool.query.mockResolvedValueOnce([rows]);

    const result = await listTransactions();

    expect(result.rows).toBe(rows);
  });
});
