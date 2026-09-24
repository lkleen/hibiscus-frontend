import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import { listTransactions, updateTransactionCategory } from './umsatz';

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

  it('selects every row unfiltered and unpaged', async () => {
    pool.query.mockResolvedValueOnce([[]]);

    await listTransactions();

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain('FROM umsatz');
    expect(sql).not.toContain('WHERE');
    expect(sql).not.toContain('LIMIT');
  });

  it('returns the rows exactly as the database delivered them', async () => {
    const rows: Record<string, unknown>[] = [
      {
        id: 2,
        konto_id: 3,
        empfaenger_name: null,
        zweck: 'EREF+',
        zweck3: 'SVWZ+text',
        betrag: -9,
      },
      { id: 1, konto_id: 5, empfaenger_name: 'Shop', zweck: 'LASTSCHRIFT / BELASTUNG', betrag: 4 },
    ];
    pool.query.mockResolvedValueOnce([rows]);

    const result = await listTransactions();

    expect(result).toBe(rows);
  });
});

describe('updateTransactionCategory', () => {
  it('sends the id and categoryId as parameterized query params', async () => {
    const pool = makeFakePool();
    pool.query.mockResolvedValueOnce([{}]);
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);

    await updateTransactionCategory(42, 5);

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE umsatz SET umsatztyp_id = ? WHERE id = ?');
    expect(params).toEqual([5, 42]);
  });
});
