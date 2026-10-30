import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({ getAppPool: vi.fn() }));

import { getAppPool } from '../db/pool';
import {
  createAppUserKey,
  deleteAppUserKey,
  ensureAppUserTable,
  getAppUserDatabase,
  getAppUserKey,
  isDatabaseUsedByOther,
  listAppUsersWithDatabase,
  saveAppUserDatabase,
  updateAppUserKey,
} from './app-user';
import type { AppUserDatabaseRecord, AppUserKeyRecord } from './app-user';

let pool: { query: ReturnType<typeof vi.fn> };

const secret = { ciphertext: Buffer.from('c'), iv: Buffer.from('i'), tag: Buffer.from('t') };

beforeEach(() => {
  vi.resetAllMocks();
  pool = { query: vi.fn().mockResolvedValue([[]]) };
  vi.mocked(getAppPool).mockReturnValue(pool as unknown as Pool);
});

describe('app-user repository', () => {
  it('creates hf_app_user with the database and the key columns on the app pool', async () => {
    await ensureAppUserTable();

    const sql: string = pool.query.mock.calls[0]![0];
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS hf_app_user');
    for (const column of [
      'username VARCHAR(255) NOT NULL',
      'db_password_ciphertext',
      'db_version INT NOT NULL DEFAULT 0',
      "key_mode ENUM('manual', 'memory', 'stored') NULL",
      'key_check VARBINARY(32) NULL',
      'key_wrapped_ciphertext',
      'PRIMARY KEY (username)',
      'UNIQUE KEY uq_hf_app_user_database (db_host, db_port, db_name)',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('adds the unique key to an existing table only when it is missing', async () => {
    await ensureAppUserTable();
    expect(pool.query.mock.calls[1]![0]).toContain('information_schema.STATISTICS');
    expect(pool.query.mock.calls[2]![0]).toContain('ALTER TABLE hf_app_user ADD UNIQUE KEY');

    pool.query.mockReset();
    pool.query
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ INDEX_NAME: 'uq_hf_app_user_database' }]]);
    await ensureAppUserTable();
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('finds another user on the same database, host lower-cased', async () => {
    pool.query.mockResolvedValueOnce([[{ username: 'bob' }]]);
    const settings = { host: 'Hibiscus-DB', port: 3306, name: 'x', user: 'u' };

    expect(await isDatabaseUsedByOther('alice', settings)).toBe(true);
    expect(pool.query.mock.calls[0]![1]).toEqual(['alice', 'hibiscus-db', 3306, 'x']);
    expect(await isDatabaseUsedByOther('alice', settings)).toBe(false);
  });

  it('maps a stored row to the settings, encrypted password and version', async () => {
    pool.query.mockResolvedValue([
      [
        {
          db_host: 'hibiscus-db',
          db_port: 3306,
          db_name: 'alice',
          db_user: 'alice',
          db_password_ciphertext: secret.ciphertext,
          db_password_iv: secret.iv,
          db_password_tag: secret.tag,
          db_version: 4,
        },
      ],
    ]);

    const record: AppUserDatabaseRecord | null = await getAppUserDatabase('alice');

    expect(record).toEqual({
      settings: { host: 'hibiscus-db', port: 3306, name: 'alice', user: 'alice' },
      password: secret,
      version: 4,
    });
    expect(pool.query.mock.calls[0]![0]).toContain('db_host IS NOT NULL');
    expect(pool.query.mock.calls[0]![1]).toEqual(['alice']);
  });

  it('answers null for a user without a database', async () => {
    expect(await getAppUserDatabase('carol')).toBeNull();
  });

  it('creates the row, then updates it and raises the version', async () => {
    await saveAppUserDatabase({
      username: 'alice',
      settings: { host: 'hibiscus-db', port: 3306, name: 'alice', user: 'alice' },
      password: secret,
    });

    expect(pool.query.mock.calls[0]![0]).toContain('INSERT IGNORE INTO hf_app_user');
    const sql: string = pool.query.mock.calls[1]![0];
    expect(sql).not.toContain('ON DUPLICATE KEY');
    expect(sql).toContain('db_version = db_version + 1');
    expect(pool.query.mock.calls[1]![1]).toEqual([
      'hibiscus-db',
      3306,
      'alice',
      'alice',
      secret.ciphertext,
      secret.iv,
      secret.tag,
      'alice',
    ]);
  });

  it('lists the users with a database', async () => {
    pool.query.mockResolvedValue([[{ username: 'alice' }, { username: 'bob' }]]);

    expect(await listAppUsersWithDatabase()).toEqual(['alice', 'bob']);
  });

  it('maps the key columns, with the wrapped key only when stored', async () => {
    const check: Buffer = Buffer.alloc(32, 1);
    pool.query.mockResolvedValueOnce([
      [
        {
          key_mode: 'stored',
          key_check: check,
          key_wrapped_ciphertext: secret.ciphertext,
          key_wrapped_iv: secret.iv,
          key_wrapped_tag: secret.tag,
        },
      ],
    ]);
    pool.query.mockResolvedValueOnce([
      [
        {
          key_mode: 'manual',
          key_check: check,
          key_wrapped_ciphertext: null,
          key_wrapped_iv: null,
          key_wrapped_tag: null,
        },
      ],
    ]);

    expect(await getAppUserKey('alice')).toEqual({ mode: 'stored', check, wrapped: secret });
    expect(await getAppUserKey('alice')).toEqual({ mode: 'manual', check, wrapped: null });
  });

  it('answers null without a key or without a row', async () => {
    pool.query.mockResolvedValueOnce([[{ key_mode: null, key_check: null }]]);

    expect(await getAppUserKey('alice')).toBeNull();
    expect(await getAppUserKey('carol')).toBeNull();
  });

  const record: AppUserKeyRecord = { mode: 'memory', check: Buffer.alloc(32, 2), wrapped: null };

  it('creates the first key only while none is configured', async () => {
    pool.query
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    expect(await createAppUserKey('alice', record)).toBe(true);
    expect(await createAppUserKey('alice', record)).toBe(false);
    expect(pool.query.mock.calls[0]![0]).toContain('INSERT IGNORE INTO hf_app_user');
    expect(pool.query.mock.calls[1]![0]).toContain('key_mode IS NULL');
    expect(pool.query.mock.calls[1]![1]).toEqual([
      'memory',
      record.check,
      null,
      null,
      null,
      'alice',
    ]);
  });

  it('updates the key only while it holds the expected check value', async () => {
    const expectedCheck: Buffer = Buffer.alloc(32, 3);
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await updateAppUserKey('alice', { expectedCheck, next: record });
    expect(pool.query.mock.calls[0]![0]).toContain('key_check = ?');
    expect(pool.query.mock.calls[0]![1]).toEqual([
      'memory',
      record.check,
      null,
      null,
      null,
      'alice',
      expectedCheck,
    ]);

    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(updateAppUserKey('alice', { expectedCheck, next: record })).rejects.toThrow(
      'changed',
    );
  });

  it('deletes the key columns', async () => {
    await deleteAppUserKey('alice');

    const sql: string = pool.query.mock.calls[0]![0];
    expect(sql).toContain('key_mode = NULL');
    expect(sql).toContain('key_wrapped_ciphertext = NULL');
  });
});
