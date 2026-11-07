import { beforeEach, describe, expect, it } from 'vitest';
import type { UserDatabaseSettings } from '@hibiscus-frontend/shared/contracts/user';
import type { AppUserDatabaseRecord, AppUserKeyRecord } from '../repositories/app-user';
import { DuplicateKeyError } from '../repositories/repository-errors';
import type { EncryptedSecret } from '../sync/credential-crypto';
import { DemoAppUserRepository } from './demo-app-user-repository';
import { createDemoStore } from './demo-store';
import { createTestDataset } from './demo-test-dataset.fixture';

const SETTINGS: UserDatabaseSettings = {
  host: 'db.local',
  port: 3306,
  name: 'hibiscus',
  user: 'u',
};
const PASSWORD: EncryptedSecret = {
  ciphertext: Buffer.from('pw'),
  iv: Buffer.alloc(12),
  tag: Buffer.alloc(16),
};
const KEY: AppUserKeyRecord = { mode: 'stored', check: Buffer.from('check-1'), wrapped: null };

describe('DemoAppUserRepository', () => {
  let repository: DemoAppUserRepository;

  beforeEach(() => {
    repository = new DemoAppUserRepository(createDemoStore(createTestDataset()));
  });

  it('saves the database settings and raises the version', async () => {
    expect(await repository.getDatabase('anna')).toBeNull();
    await repository.saveDatabase({ username: 'anna', settings: SETTINGS, password: PASSWORD });
    await repository.saveDatabase({ username: 'anna', settings: SETTINGS, password: PASSWORD });
    const stored: AppUserDatabaseRecord | null = await repository.getDatabase('anna');
    expect(stored).toEqual({ settings: SETTINGS, password: PASSWORD, version: 2 });
    expect(await repository.listUsersWithDatabase()).toEqual(['anna']);
  });

  it("refuses another user's database (host case-insensitively)", async () => {
    await repository.saveDatabase({ username: 'anna', settings: SETTINGS, password: PASSWORD });
    const same: UserDatabaseSettings = { ...SETTINGS, host: 'DB.LOCAL', user: 'other' };
    expect(await repository.isDatabaseUsedByOther('bert', same)).toBe(true);
    expect(await repository.isDatabaseUsedByOther('anna', same)).toBe(false);
    await expect(
      repository.saveDatabase({ username: 'bert', settings: same, password: PASSWORD }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    expect(await repository.getDatabase('bert')).toBeNull();
  });

  it('creates the first key only once, also for a user without a record', async () => {
    expect(await repository.getKey('anna')).toBeNull();
    expect(await repository.createKey('anna', KEY)).toBe(true);
    expect(await repository.createKey('anna', { ...KEY, mode: 'manual' })).toBe(false);
    expect(await repository.getKey('anna')).toEqual(KEY);
    expect(await repository.getDatabase('anna')).toBeNull();
  });

  it('updates the key only while it holds expectedCheck', async () => {
    await repository.createKey('anna', KEY);
    const next: AppUserKeyRecord = { mode: 'manual', check: Buffer.from('check-2'), wrapped: null };
    await expect(
      repository.updateKey('anna', { expectedCheck: Buffer.from('wrong'), next }),
    ).rejects.toThrow(/changed/);
    await repository.updateKey('anna', { expectedCheck: Buffer.from('check-1'), next });
    expect(await repository.getKey('anna')).toEqual(next);
    await expect(
      repository.updateKey('nobody', { expectedCheck: Buffer.from('check-1'), next }),
    ).rejects.toThrow();
  });

  it('deletes the key', async () => {
    await repository.createKey('anna', KEY);
    await repository.deleteKey('anna');
    await repository.deleteKey('nobody');
    expect(await repository.getKey('anna')).toBeNull();
  });
});
