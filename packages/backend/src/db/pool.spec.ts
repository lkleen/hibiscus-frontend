import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserDatabaseTestResponse } from '@hibiscus-frontend/shared/contracts/user';

vi.mock('mysql2/promise', () => ({ default: { createConnection: vi.fn(), createPool: vi.fn() } }));

import mysql from 'mysql2/promise';
import {
  currentUser,
  DatabaseNotConfiguredError,
  getAppPool,
  getPool,
  runWithUserContext,
  testDatabaseConnection,
  withoutPassword,
} from './pool';
import type { DatabaseTarget, UserDatabaseHandle } from './pool';

const PASSWORD = 's3cret-db-pass';

const target: DatabaseTarget = {
  host: 'hibiscus-db',
  port: 3306,
  name: 'alice',
  user: 'alice',
  password: PASSWORD,
};

function handle(name: string): UserDatabaseHandle {
  return {
    pool: { name } as unknown as Pool,
    settings: { host: 'hibiscus-db', port: 3306, name, user: name },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('user context', () => {
  it('throws a plain error outside of any context', () => {
    expect(() => getPool()).toThrow('No user context');
    expect(() => getPool()).not.toThrow(DatabaseNotConfiguredError);
    expect(() => currentUser()).toThrow('No user context');
  });

  it('throws DatabaseNotConfiguredError for a user without a database', () => {
    runWithUserContext({ user: 'alice', database: null }, () => {
      expect(currentUser().user).toBe('alice');
      expect(() => getPool()).toThrow(DatabaseNotConfiguredError);
    });
  });

  it('keeps two users isolated across interleaved async work', async () => {
    const alice: UserDatabaseHandle = handle('alice');
    const bob: UserDatabaseHandle = handle('bob');
    const seen: string[] = [];
    const work = async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => setTimeout(resolve, 5));
      seen.push(`${currentUser().user}:${(getPool() as unknown as { name: string }).name}`);
      await Promise.resolve();
      seen.push(`${currentUser().user}:${(getPool() as unknown as { name: string }).name}`);
    };

    await Promise.all([
      runWithUserContext({ user: 'alice', database: alice }, work),
      runWithUserContext({ user: 'bob', database: bob }, work),
    ]);

    expect(seen.sort()).toEqual(['alice:alice', 'alice:alice', 'bob:bob', 'bob:bob']);
  });

  it('refuses the app pool before startup created it', () => {
    expect(() => getAppPool()).toThrow('App DB pool not initialized');
  });
});

describe('withoutPassword', () => {
  it('masks every occurrence of the password', () => {
    expect(withoutPassword(`a ${PASSWORD} b ${PASSWORD}`, PASSWORD)).toBe('a *** b ***');
  });
});

describe('testDatabaseConnection', () => {
  it('reports the Hibiscus schema when konto and umsatz exist', async () => {
    const destroy = vi.fn();
    const query = vi.fn().mockResolvedValue([[{ name: 'konto' }, { name: 'umsatz' }]]);
    vi.mocked(mysql.createConnection).mockResolvedValue({ query, destroy } as never);

    const result: UserDatabaseTestResponse = await testDatabaseConnection(target);

    expect(result).toEqual({ ok: true, hibiscusSchema: true, error: null });
    expect(vi.mocked(mysql.createConnection).mock.calls[0]?.[0]).toMatchObject({
      host: 'hibiscus-db',
      database: 'alice',
      connectTimeout: 5000,
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('reports a database without the Hibiscus tables', async () => {
    const query = vi.fn().mockResolvedValue([[{ name: 'konto' }]]);
    vi.mocked(mysql.createConnection).mockResolvedValue({ query, destroy: vi.fn() } as never);

    const result: UserDatabaseTestResponse = await testDatabaseConnection(target);

    expect(result).toEqual({ ok: true, hibiscusSchema: false, error: null });
  });

  it('returns a failure without the password in its text', async () => {
    vi.mocked(mysql.createConnection).mockRejectedValue(
      new Error(`Access denied for 'alice' with password ${PASSWORD}`),
    );

    const result: UserDatabaseTestResponse = await testDatabaseConnection(target);

    expect(result.ok).toBe(false);
    expect(result.hibiscusSchema).toBe(false);
    expect(result.error).toContain('Access denied');
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });
});
