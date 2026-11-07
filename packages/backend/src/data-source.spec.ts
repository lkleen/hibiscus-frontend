import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TransactionsResponse } from '@hibiscus-frontend/shared/contracts/transactions';
import type { Config } from './config/config';
import { createDataSource, createDemoUserKeys } from './data-source';
import type { DataSourceParts } from './data-source';
import { DEMO_DATA_FILE_NAME, encodeDemoDataset } from './demo/demo-dataset';
import { DemoSyncDatabase } from './demo/demo-sync-database';
import { DemoUserDatabases } from './demo/demo-user-databases';
import { createTestDataset } from './demo/demo-test-dataset.fixture';
import type { AppUserKeyRecord } from './repositories/app-user';
import { demoDatePresets } from './demo/demo-date-presets';
import { DATE_PRESETS_SETTING_KEY } from './settings/date-presets';
import { CredentialCrypto } from './sync/credential-crypto';
import { UserKeys, UserKeyStore } from './sync/user-keys';

const crypto: CredentialCrypto = new CredentialCrypto(randomBytes(32));
const config: Config = {
  DATA_SOURCE: 'demo',
  PORT: 3000,
  AUTH_HEADER_USER: 'X-Forwarded-User',
  ALLOWED_USERS: ['alice@example.com', 'bob@example.com'],
  INTERNAL_PROXY_SECRET: 'secret',
  BANK_CREDENTIALS_KEY: randomBytes(32),
};

let directory: string;
let demoDataPath: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'hibiscus-demo-'));
  demoDataPath = join(directory, DEMO_DATA_FILE_NAME);
  writeFileSync(demoDataPath, encodeDemoDataset(createTestDataset()));
  vi.spyOn(console, 'log').mockImplementation((): void => undefined);
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function createDemo(): Promise<DataSourceParts> {
  return createDataSource({ config, crypto, demoDataPath });
}

describe('createDataSource with the demo data', () => {
  it('builds the in-memory implementations from the data file', async () => {
    const parts: DataSourceParts = await createDemo();

    expect(parts.databases).toBeInstanceOf(DemoUserDatabases);
    expect(parts.syncDatabase).toBeInstanceOf(DemoSyncDatabase);
    expect(parts.allowedDbHosts).toEqual([]);
    const response: TransactionsResponse = await parts.repositories.transactions.list();
    expect(response.rows).toHaveLength(3);
    expect(await parts.databases.databaseStatus('alice@example.com')).toBe('configured');
  });

  it('starts every allowed user on a date range that holds data', async () => {
    const parts: DataSourceParts = await createDemo();

    for (const user of config.ALLOWED_USERS) {
      expect(await parts.repositories.userSettings.get(user, DATE_PRESETS_SETTING_KEY)).toEqual(
        demoDatePresets(createTestDataset().generatedAt),
      );
    }
  });

  it('logs that changes stay in memory', async () => {
    await createDemo();

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Demo data: changes stay in memory'),
    );
  });

  it('tests no database connection', async () => {
    const parts: DataSourceParts = await createDemo();

    await expect(
      parts.testDatabase({ host: 'h', port: 3306, name: 'n', user: 'u', password: 'p' }),
    ).rejects.toThrow('demo data');
  });

  it('throws when the data file is missing', async () => {
    await expect(
      createDataSource({ config, crypto, demoDataPath: join(directory, 'missing.json.gz') }),
    ).rejects.toThrow();
  });
});

describe('createDemoUserKeys', () => {
  it('gives every allowed user a stored key', async () => {
    const parts: DataSourceParts = await createDemo();
    const keys: UserKeys = new UserKeys({
      serverCrypto: crypto,
      store: new UserKeyStore(),
      appUsers: parts.repositories.appUsers,
      bankConnections: parts.repositories.bankConnections,
    });

    await createDemoUserKeys(keys, config.ALLOWED_USERS);

    for (const user of config.ALLOWED_USERS) {
      const record: AppUserKeyRecord | null = await parts.repositories.appUsers.getKey(user);
      expect(record?.mode).toBe('stored');
      expect(await keys.unattendedState(user)).toBe('ready');
    }
  });
});
