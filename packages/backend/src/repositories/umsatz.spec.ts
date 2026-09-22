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

  it('builds an unfiltered query using only limit/offset', async () => {
    pool.query.mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);

    await listTransactions({ limit: 25, offset: 0 });

    const [countSql, countParams] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).not.toContain('WHERE');
    expect(countParams).toEqual([]);

    const [selectSql, selectParams] = pool.query.mock.calls[1] as [string, unknown[]];
    expect(selectSql).not.toContain('WHERE');
    expect(selectSql).toContain('LIMIT ? OFFSET ?');
    expect(selectParams).toEqual([25, 0]);
  });

  it('filters by accountId', async () => {
    pool.query.mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);

    await listTransactions({ accountId: 7, limit: 10, offset: 0 });

    const [countSql, countParams] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('WHERE konto_id = ?');
    expect(countParams).toEqual([7]);
  });

  it('filters by a from/to date range', async () => {
    pool.query.mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);

    await listTransactions({ from: '2026-01-01', to: '2026-01-31', limit: 10, offset: 0 });

    const [countSql, countParams] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('datum >= ?');
    expect(countSql).toContain('datum <= ?');
    expect(countParams).toEqual(['2026-01-01', '2026-01-31']);
  });

  it('filters uncategorized transactions when categoryId is null', async () => {
    pool.query.mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);

    await listTransactions({ categoryId: null, limit: 10, offset: 0 });

    const [countSql, countParams] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('umsatztyp_id IS NULL');
    expect(countParams).toEqual([]);
  });

  it('filters by a specific categoryId', async () => {
    pool.query.mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);

    await listTransactions({ categoryId: 3, limit: 10, offset: 0 });

    const [countSql, countParams] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('umsatztyp_id = ?');
    expect(countParams).toEqual([3]);
  });

  it('filters by free-text q over zweck and empfaenger_name', async () => {
    pool.query.mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);

    await listTransactions({ q: 'rent', limit: 10, offset: 0 });

    const [countSql, countParams] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('(zweck LIKE ? OR empfaenger_name LIKE ?)');
    expect(countParams).toEqual(['%rent%', '%rent%']);
  });

  it('combines multiple filters with AND, in a stable parameter order, and appends limit/offset only to the select', async () => {
    pool.query.mockResolvedValueOnce([[{ total: 2 }]]).mockResolvedValueOnce([[]]);

    const result = await listTransactions({
      accountId: 7,
      from: '2026-01-01',
      to: '2026-01-31',
      categoryId: 3,
      q: 'rent',
      limit: 10,
      offset: 20,
    });

    const [countSql, countParams] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain(
      'WHERE konto_id = ? AND datum >= ? AND datum <= ? AND umsatztyp_id = ? AND (zweck LIKE ? OR empfaenger_name LIKE ?)',
    );
    expect(countParams).toEqual([7, '2026-01-01', '2026-01-31', 3, '%rent%', '%rent%']);

    const [, selectParams] = pool.query.mock.calls[1] as [string, unknown[]];
    expect(selectParams).toEqual([7, '2026-01-01', '2026-01-31', 3, '%rent%', '%rent%', 10, 20]);
    expect(result.total).toBe(2);
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
