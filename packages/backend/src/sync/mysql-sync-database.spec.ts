import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({ currentDatabase: vi.fn(), getPool: vi.fn() }));
vi.mock('./umsatz-merge', () => ({ mergeStatement: vi.fn() }));

import { currentDatabase, getPool } from '../db/pool';
import type { UserDatabaseHandle } from '../db/pool';
import type { MergeParams } from './fetched-booking';
import { MysqlSyncDatabase } from './mysql-sync-database';
import type { SyncLock } from './sync-database';
import { mergeStatement } from './umsatz-merge';

interface FakeConnection {
  query: ReturnType<typeof vi.fn>;
  beginTransaction: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const LOCK_NAME = 'hf_sync_58ff5a7f06d50c6b_3';

const mergeParams: MergeParams = { kontoId: 11, bookings: [], balance: null };

let connection: FakeConnection;
let acquired: number | null;
let latest: string | null;
let database: MysqlSyncDatabase;

beforeEach(() => {
  vi.resetAllMocks();
  acquired = 1;
  latest = '2026-10-20';
  connection = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired }]];
      if (sql.includes('MAX(datum)')) return [[{ latest }]];
      return [[{}]];
    }),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    destroy: vi.fn(),
  };
  vi.mocked(getPool).mockReturnValue({
    getConnection: vi.fn().mockResolvedValue(connection),
  } as unknown as Pool);
  vi.mocked(currentDatabase).mockReturnValue({
    pool: null,
    settings: { host: 'hibiscus-db', port: 3306, name: 'alice', user: 'alice' },
  } as UserDatabaseHandle);
  vi.mocked(mergeStatement).mockResolvedValue({ inserted: 2, deleted: 1 });
  database = new MysqlSyncDatabase();
});

function calls(fragment: string): unknown[][] {
  return connection.query.mock.calls.filter((call: unknown[]) =>
    String(call[0]).includes(fragment),
  );
}

async function takeLock(): Promise<SyncLock> {
  const lock: SyncLock | null = await database.lock(3);
  if (lock === null) throw new Error('The lock was not acquired');
  return lock;
}

describe('MysqlSyncDatabase.lock', () => {
  it('takes GET_LOCK without waiting, named after the user database, and keeps the connection', async () => {
    const lock: SyncLock = await takeLock();

    expect(lock.connectionId).toBe(3);
    expect(calls('GET_LOCK')[0]?.[0]).toContain('GET_LOCK(?, 0)');
    expect(calls('GET_LOCK')[0]?.[1]).toEqual([LOCK_NAME]);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('answers null and returns the connection when another run holds the lock', async () => {
    acquired = 0;

    expect(await database.lock(3)).toBeNull();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(calls('RELEASE_LOCK')).toHaveLength(0);
  });

  it('throws and returns the connection when GET_LOCK fails', async () => {
    acquired = null;

    await expect(database.lock(3)).rejects.toThrow('GET_LOCK for connection 3 failed');
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});

describe('MysqlSyncLock.release', () => {
  it('releases the lock and returns the connection to the pool', async () => {
    const lock: SyncLock = await takeLock();

    await lock.release();

    expect(calls('RELEASE_LOCK')[0]?.[1]).toEqual([LOCK_NAME]);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('destroys the connection, which frees the lock, when releasing fails', async () => {
    const lock: SyncLock = await takeLock();
    connection.query.mockRejectedValueOnce(new Error('connection lost'));

    await expect(lock.release()).rejects.toThrow('connection lost');
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('refuses work on a released lock', async () => {
    const lock: SyncLock = await takeLock();
    await lock.release();

    await expect(lock.release()).rejects.toThrow('released');
    await expect(database.latestBookedDate(lock, 11)).rejects.toThrow('released');
  });
});

describe('MysqlSyncDatabase.latestBookedDate', () => {
  it('reads the newest booked date on the lock connection, ignoring pending rows', async () => {
    const lock: SyncLock = await takeLock();

    expect(await database.latestBookedDate(lock, 11)).toBe('2026-10-20');
    const [sql, values] = calls('MAX(datum)')[0] as [string, unknown[]];
    expect(sql).toContain('(COALESCE(flags, 0) & 2) = 0');
    expect(values).toEqual([11]);
  });

  it('answers null for a konto without booked rows', async () => {
    latest = null;
    const lock: SyncLock = await takeLock();

    expect(await database.latestBookedDate(lock, 11)).toBeNull();
  });
});

describe('MysqlSyncDatabase.mergeInTransaction', () => {
  it('merges on the lock connection inside one committed transaction', async () => {
    const lock: SyncLock = await takeLock();

    expect(await database.mergeInTransaction(lock, mergeParams)).toEqual({
      inserted: 2,
      deleted: 1,
    });
    expect(mergeStatement).toHaveBeenCalledWith(connection, mergeParams);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows when the merge fails', async () => {
    const lock: SyncLock = await takeLock();
    vi.mocked(mergeStatement).mockRejectedValueOnce(new Error('merge broke'));

    await expect(database.mergeInTransaction(lock, mergeParams)).rejects.toThrow('merge broke');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('refuses a lock it did not take', async () => {
    const foreign: SyncLock = { connectionId: 3, release: vi.fn() };

    await expect(database.mergeInTransaction(foreign, mergeParams)).rejects.toThrow(
      'not taken by MySQL',
    );
  });
});
