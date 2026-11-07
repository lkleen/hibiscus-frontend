import type { Pool } from 'mysql2/promise';
import type {
  TransactionAssignRequest,
  TransactionEditableFields,
  TransactionUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import { MissingReferenceError } from './repository-errors';
import { MysqlTransactionRepository, TRANSACTION_COLUMNS } from './umsatz';

const repository: MysqlTransactionRepository = new MysqlTransactionRepository();

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

    await repository.list();

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [options] = pool.query.mock.calls[0] as [{ sql: string; rowsAsArray: boolean }];
    expect(options.rowsAsArray).toBe(true);
    expect(options.sql).toContain('FROM umsatz');
    expect(options.sql).not.toContain('WHERE');
    expect(options.sql).not.toContain('LIMIT');
  });

  it('selects exactly the response columns, in response order', async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const result = await repository.list();

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

    const result = await repository.list();

    expect(result.rows).toBe(rows);
  });
});

describe('updateTransaction', () => {
  let pool: FakePool;

  beforeEach(() => {
    pool = makeFakePool();
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
  });

  const request: TransactionUpdateRequest = {
    expected: { kommentar: null, umsatztyp_id: 3 },
    next: { kommentar: 'Miete', umsatztyp_id: null },
  };

  it('writes only kommentar and umsatztyp_id, guarded by the expected values', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await repository.update(42, request);

    expect(result).toBe('updated');
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql.replace(/\s+/g, ' ')).toBe(
      'UPDATE umsatz SET kommentar = ?, umsatztyp_id = ? WHERE id = ? AND kommentar <=> ? AND umsatztyp_id <=> ?',
    );
    expect(params).toEqual(['Miete', null, 42, null, 3]);
  });

  it('treats an update to identical values as updated', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const same: TransactionEditableFields = { kommentar: 'x', umsatztyp_id: 1 };
    const result = await repository.update(1, { expected: same, next: same });

    expect(result).toBe('updated');
  });

  it('reports not-found when nothing matched and the row does not exist', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([[]]);

    expect(await repository.update(42, request)).toBe('not-found');
    const [sql, params] = pool.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toBe('SELECT 1 FROM umsatz WHERE id = ?');
    expect(params).toEqual([42]);
  });

  it('reports conflict when nothing matched but the row exists', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([[{ 1: 1 }]]);

    expect(await repository.update(42, request)).toBe('conflict');
  });

  it('throws on an unexpected affected row count', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 2 }]);

    await expect(repository.update(42, request)).rejects.toThrow('affected 2 rows');
  });
});

describe('assignCategory', () => {
  interface FakeConnection {
    beginTransaction: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  }
  let connection: FakeConnection;

  beforeEach(() => {
    connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    const pool: { getConnection: ReturnType<typeof vi.fn> } = {
      getConnection: vi.fn().mockResolvedValue(connection),
    };
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
  });

  const request: TransactionAssignRequest = {
    items: [
      { id: 9, expected: { kommentar: null, umsatztyp_id: 3 } },
      { id: 4, expected: { kommentar: 'x', umsatztyp_id: null } },
    ],
    umsatztyp_id: 7,
  };

  it('updates every row in id order, writing only umsatztyp_id, then commits', async () => {
    connection.query.mockResolvedValue([{ affectedRows: 1 }]);

    expect(await repository.assignCategory(request)).toEqual({ result: 'assigned' });

    expect(connection.query).toHaveBeenCalledTimes(2);
    const [sql, params] = connection.query.mock.calls[0] as [string, unknown[]];
    expect(sql.replace(/\s+/g, ' ')).toBe(
      'UPDATE umsatz SET umsatztyp_id = ? WHERE id = ? AND kommentar <=> ? AND umsatztyp_id <=> ?',
    );
    expect(params).toEqual([7, 4, 'x', null]);
    expect((connection.query.mock.calls[1] as [string, unknown[]])[1]).toEqual([7, 9, null, 3]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and reports all conflicting ids when a row no longer matches', async () => {
    connection.query.mockResolvedValue([{ affectedRows: 0 }]);

    expect(await repository.assignCategory(request)).toEqual({
      result: 'conflict',
      conflictIds: [4, 9],
    });

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back, rethrows and releases when a statement fails', async () => {
    const error: Error = new Error('fk');
    connection.query.mockRejectedValue(error);

    await expect(repository.assignCategory(request)).rejects.toBe(error);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('throws on an unexpected affected row count', async () => {
    connection.query.mockResolvedValue([{ affectedRows: 2 }]);

    await expect(repository.assignCategory(request)).rejects.toThrow('affected 2 rows');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});

describe('foreign key translation', () => {
  function driverError(): Error {
    return Object.assign(new Error('fk_umsatz_umsatztyp'), { code: 'ER_NO_REFERENCED_ROW_2' });
  }

  it('turns an unknown category on update into MissingReferenceError(category)', async () => {
    const cause: Error = driverError();
    vi.mocked(getPool).mockReturnValue({
      query: vi.fn().mockRejectedValueOnce(cause),
    } as unknown as Pool);

    const failure: unknown = await repository
      .update(1, {
        expected: { kommentar: null, umsatztyp_id: 3 },
        next: { kommentar: null, umsatztyp_id: 99 },
      })
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MissingReferenceError);
    expect((failure as MissingReferenceError).reference).toBe('category');
    expect((failure as MissingReferenceError).cause).toBe(cause);
  });

  it('turns an unknown category on assign into MissingReferenceError(category) after rollback', async () => {
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockRejectedValueOnce(driverError()),
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    vi.mocked(getPool).mockReturnValue({
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool);

    await expect(
      repository.assignCategory({
        items: [{ id: 1, expected: { kommentar: null, umsatztyp_id: null } }],
        umsatztyp_id: 99,
      }),
    ).rejects.toBeInstanceOf(MissingReferenceError);
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it('leaves other driver errors untouched', async () => {
    const boom: Error = new Error('boom');
    vi.mocked(getPool).mockReturnValue({
      query: vi.fn().mockRejectedValueOnce(boom),
    } as unknown as Pool);

    await expect(
      repository.update(1, {
        expected: { kommentar: null, umsatztyp_id: 3 },
        next: { kommentar: null, umsatztyp_id: 4 },
      }),
    ).rejects.toBe(boom);
  });
});
