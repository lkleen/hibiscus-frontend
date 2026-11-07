import type { UserDatabaseTestResponse } from '@hibiscus-frontend/shared/contracts/user';
import type { AllowedDbHost, Config, DemoConfig, MariadbConfig } from './config/config';
import { initAppPool, testDatabaseConnection } from './db/pool';
import type { DatabaseTarget } from './db/pool';
import type { UserDatabases } from './db/user-databases';
import { UserPools } from './db/user-pools';
import { createDemoRepositories } from './demo/create-demo-repositories';
import type { DemoRepositories } from './demo/create-demo-repositories';
import { demoDatePresets } from './demo/demo-date-presets';
import { loadDemoDataset } from './demo/demo-dataset';
import type { DemoDataset } from './demo/demo-dataset';
import { DemoSyncDatabase } from './demo/demo-sync-database';
import { DemoUserDatabases } from './demo/demo-user-databases';
import { ensureAppUserTable } from './repositories/app-user';
import { createMysqlRepositories } from './repositories/create-mysql-repositories';
import { DATE_PRESETS_SETTING_KEY } from './settings/date-presets';
import type { Repositories } from './repositories/repositories';
import type { CredentialCrypto } from './sync/credential-crypto';
import { MysqlSyncDatabase } from './sync/mysql-sync-database';
import type { SyncDatabase } from './sync/sync-database';
import type { UserKeys } from './sync/user-keys';

/** Everything that differs between `DATA_SOURCE=mariadb` and `DATA_SOURCE=demo`. */
export interface DataSourceParts {
  readonly repositories: Repositories;
  readonly databases: UserDatabases;
  readonly syncDatabase: SyncDatabase;
  /** For `/api/user/database`: the hosts users may name; none with the demo data. */
  readonly allowedDbHosts: readonly AllowedDbHost[];
  /** For `/api/user/database`; with the demo data the router answers `409` before calling it. */
  readonly testDatabase: (target: DatabaseTarget) => Promise<UserDatabaseTestResponse>;
}

export interface DataSourceParams {
  readonly config: Config;
  /** The server key instance; `UserPools` decrypts the users' database passwords with it. */
  readonly crypto: CredentialCrypto;
  /** The demo data file; read only with `DATA_SOURCE=demo` (`demoDataFilePath()` in the server). */
  readonly demoDataPath: string;
}

const LOG_PREFIX = '[hibiscus-backend]';

async function createMariadbParts(
  config: MariadbConfig,
  crypto: CredentialCrypto,
): Promise<DataSourceParts> {
  initAppPool(config);
  // The app database holds only `hf_app_user`; each user's `hf_*` tables are created on their
  // own database when its pool is first used (see `db/user-pools.ts`).
  await ensureAppUserTable();
  const repositories: Repositories = createMysqlRepositories();
  return {
    repositories,
    databases: new UserPools({
      crypto,
      allowedHosts: config.ALLOWED_DB_HOSTS,
      appUsers: repositories.appUsers,
    }),
    syncDatabase: new MysqlSyncDatabase(),
    allowedDbHosts: config.ALLOWED_DB_HOSTS,
    testDatabase: testDatabaseConnection,
  };
}

/**
 * The demo data in memory: no pool, no database reached, nothing written back to the file. Each
 * allowed user starts on date presets whose first range holds data (see `demoDatePresets`).
 */
async function createDemoParts(config: DemoConfig, demoDataPath: string): Promise<DataSourceParts> {
  const dataset: DemoDataset = loadDemoDataset(demoDataPath);
  console.log(
    `${LOG_PREFIX} Demo data from ${demoDataPath} (up to ${dataset.generatedAt}): ` +
      `${dataset.accounts.length} accounts, ${dataset.transactions.length} transactions, ` +
      `${dataset.categories.length} categories, ${dataset.taxTags.length} tax tags`,
  );
  console.log(`${LOG_PREFIX} Demo data: changes stay in memory and are lost on restart`);
  const demo: DemoRepositories = createDemoRepositories(dataset);
  for (const user of config.ALLOWED_USERS) {
    await demo.repositories.userSettings.put({
      user,
      key: DATE_PRESETS_SETTING_KEY,
      value: demoDatePresets(dataset.generatedAt),
    });
  }
  return {
    repositories: demo.repositories,
    databases: new DemoUserDatabases(demo.store),
    syncDatabase: new DemoSyncDatabase(),
    allowedDbHosts: [],
    testDatabase: async (): Promise<UserDatabaseTestResponse> => {
      throw new Error('No database connection can be tested with the demo data');
    },
  };
}

/** Builds the repositories and databases of the configured `DATA_SOURCE`. */
export async function createDataSource(params: DataSourceParams): Promise<DataSourceParts> {
  const { config } = params;
  switch (config.DATA_SOURCE) {
    case 'mariadb':
      return createMariadbParts(config, params.crypto);
    case 'demo':
      return createDemoParts(config, params.demoDataPath);
  }
}

/**
 * With the demo data every allowed user opens straight into the app: each gets a fresh random
 * key in `stored` mode (so unattended work could run), created through `UserKeys` like any other.
 * Runs once at startup, on the fresh in-memory store, before the server listens.
 */
export async function createDemoUserKeys(
  keys: Pick<UserKeys, 'create'>,
  users: readonly string[],
): Promise<void> {
  for (const user of users) {
    // The returned key is not needed: in `stored` mode the server keeps it wrapped.
    await keys.create(user, { mode: 'stored' });
  }
}
