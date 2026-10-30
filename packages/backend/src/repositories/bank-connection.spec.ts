import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BankConnection,
  BankConnectionSettings,
} from '@hibiscus-frontend/shared/contracts/sync';

vi.mock('../db/pool', () => ({ getPool: vi.fn() }));

import { getPool } from '../db/pool';
import {
  createBankConnection,
  getBankConnectionRecord,
  listBankConnections,
  listDueBankConnectionIds,
  replaceBankConnectionAccounts,
  updateBankConnection,
} from './bank-connection';
import type { BankConnectionRecord, BankConnectionWriteResult } from './bank-connection';

const settings: BankConnectionSettings = {
  name: 'comdirect',
  blz: '20041177',
  fintsUrl: 'https://fints.comdirect.de/fints',
  loginName: 'user',
  customerId: null,
  tanMethod: 902,
  tanMedia: null,
  syncIntervalHours: 6,
  enabled: true,
};

const pinColumns = {
  pin_ciphertext: Buffer.from('c'),
  pin_iv: Buffer.alloc(12),
  pin_tag: Buffer.alloc(16),
};

const row = {
  id: 3,
  name: 'comdirect',
  blz: '20041177',
  fints_url: 'https://fints.comdirect.de/fints',
  login_name: 'user',
  customer_id: null,
  ...pinColumns,
  tan_method: 902,
  tan_media: null,
  banking_information: '{"systemId":"s"}',
  sync_interval_hours: 6,
  enabled: 1,
  paused_reason: null,
  last_sync_at: '2026-10-29 08:00:00',
  last_status: 'success',
  last_error: null,
};

const encrypted = {
  ciphertext: Buffer.from('n'),
  iv: Buffer.alloc(12, 1),
  tag: Buffer.alloc(16, 2),
};

let pool: { query: ReturnType<typeof vi.fn>; getConnection: ReturnType<typeof vi.fn> };
let connection: {
  query: ReturnType<typeof vi.fn>;
  beginTransaction: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.resetAllMocks();
  connection = {
    query: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  pool = { query: vi.fn(), getConnection: vi.fn().mockResolvedValue(connection) };
  vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
});

describe('listBankConnections', () => {
  it('maps the rows with their accounts and never exposes the PIN or bank data', async () => {
    pool.query.mockResolvedValueOnce([[row]]).mockResolvedValueOnce([
      [
        { connection_id: 3, account_identifier: 'DE1', konto_id: 11, enabled: 1 },
        { connection_id: 9, account_identifier: 'DE9', konto_id: 99, enabled: 1 },
      ],
    ]);

    const connections: BankConnection[] = await listBankConnections();

    expect(connections).toEqual([
      {
        id: 3,
        ...settings,
        accounts: [{ accountIdentifier: 'DE1', kontoId: 11, enabled: true }],
        pausedReason: null,
        lastSyncAt: '2026-10-29 08:00:00',
        lastStatus: 'success',
        lastError: null,
      },
    ]);
    expect(Object.keys(connections[0]!)).not.toContain('pin');
    expect(JSON.stringify(connections)).not.toContain('systemId');
  });
});

describe('getBankConnectionRecord', () => {
  it('returns the encrypted PIN and the bank data', async () => {
    pool.query.mockResolvedValueOnce([[row]]).mockResolvedValueOnce([[]]);

    const record: BankConnectionRecord | null = await getBankConnectionRecord(3);

    expect(record?.pin).toEqual({
      ciphertext: pinColumns.pin_ciphertext,
      iv: pinColumns.pin_iv,
      tag: pinColumns.pin_tag,
    });
    expect(record?.bankingInformation).toBe('{"systemId":"s"}');
  });

  it('returns null for an unknown id', async () => {
    pool.query.mockResolvedValueOnce([[]]);

    expect(await getBankConnectionRecord(3)).toBeNull();
  });
});

describe('createBankConnection', () => {
  it('inserts the settings and the encrypted PIN', async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 7 }]);

    expect(await createBankConnection({ settings, pin: encrypted })).toBe(7);
    const values: unknown[] = pool.query.mock.calls[0]![1];
    expect(values).toEqual([
      'comdirect',
      '20041177',
      'https://fints.comdirect.de/fints',
      'user',
      null,
      902,
      null,
      6,
      1,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
    ]);
  });
});

describe('updateBankConnection', () => {
  function run(
    stored: unknown[],
    next: BankConnectionSettings,
  ): Promise<BankConnectionWriteResult> {
    connection.query.mockResolvedValueOnce([stored]).mockResolvedValue([{ affectedRows: 1 }]);
    return updateBankConnection({ id: 3, expected: settings, next });
  }

  it('updates when the row still holds expected, locking it first', async () => {
    expect(await run([row], { ...settings, name: 'Neu' })).toBe('updated');

    expect(connection.query.mock.calls[0]![0]).toContain('FOR UPDATE');
    const sql: string = connection.query.mock.calls[1]![0];
    expect(sql).toContain('UPDATE hf_bank_connection SET name = ?');
    expect(sql).not.toContain('pin_ciphertext');
    expect(sql).not.toContain('banking_information');
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it('drops the bank data when the bank identity changes', async () => {
    await run([row], { ...settings, loginName: 'other' });

    expect(connection.query.mock.calls[1]![0]).toContain('banking_information = NULL');
  });

  it('writes the new PIN when given', async () => {
    connection.query.mockResolvedValueOnce([[row]]).mockResolvedValue([{ affectedRows: 1 }]);

    await updateBankConnection({ id: 3, expected: settings, next: settings, pin: encrypted });

    expect(connection.query.mock.calls[1]![0]).toContain('pin_ciphertext = ?');
    expect(connection.query.mock.calls[1]![1]).toContain(encrypted.ciphertext);
  });

  it('answers conflict when the row changed and not-found when it is gone', async () => {
    expect(await run([{ ...row, tan_method: 900 }], settings)).toBe('conflict');
    expect(await run([], settings)).toBe('not-found');
    expect(connection.query).toHaveBeenCalledTimes(2);
  });

  it('rolls back and rethrows on a DB error', async () => {
    connection.query.mockRejectedValueOnce(new Error('db'));

    await expect(
      updateBankConnection({ id: 3, expected: settings, next: settings }),
    ).rejects.toThrow('db');
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });
});

describe('replaceBankConnectionAccounts', () => {
  it('replaces the whole mapping in one transaction', async () => {
    connection.query.mockResolvedValueOnce([[{ id: 3 }]]).mockResolvedValue([{}]);

    const result = await replaceBankConnectionAccounts(3, [
      { accountIdentifier: 'DE1', kontoId: 11, enabled: false },
    ]);

    expect(result).toBe('updated');
    expect(connection.query.mock.calls[1]![0]).toContain('DELETE FROM hf_bank_connection_account');
    expect(connection.query.mock.calls[2]![1]).toEqual([[[3, 'DE1', 11, 0]]]);
    expect(connection.commit).toHaveBeenCalled();
  });

  it('answers not-found for an unknown connection', async () => {
    connection.query.mockResolvedValueOnce([[]]);

    expect(await replaceBankConnectionAccounts(3, [])).toBe('not-found');
    expect(connection.query).toHaveBeenCalledTimes(1);
  });
});

describe('listDueBankConnectionIds', () => {
  it('selects enabled, unpaused connections whose interval has passed', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1 }, { id: 4 }]]);

    expect(await listDueBankConnectionIds()).toEqual([1, 4]);
    const sql: string = pool.query.mock.calls[0]![0].replace(/\s+/g, ' ');
    expect(sql).toContain('enabled = 1 AND paused_reason IS NULL');
    expect(sql).toContain(
      'last_sync_at IS NULL OR last_sync_at + INTERVAL sync_interval_hours HOUR <= NOW()',
    );
  });
});
