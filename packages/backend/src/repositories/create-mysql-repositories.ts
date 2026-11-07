import { MysqlAppUserRepository } from './app-user';
import { MysqlBankConnectionRepository } from './bank-connection';
import { MysqlAccountRepository } from './konto';
import type { Repositories } from './repositories';
import { MysqlSyncRunRepository } from './sync-run';
import { MysqlTaxSectionRepository } from './tax-section';
import { MysqlTaxTagRepository } from './tax-tag';
import { MysqlTransactionRepository } from './umsatz';
import { MysqlCategoryRepository } from './umsatztyp';
import { MysqlUserSettingRepository } from './user-setting';

/**
 * Every repository on MariaDB: `appUsers` on the app database, the others on the current user's
 * own Hibiscus database (see `db/pool.ts`).
 */
export function createMysqlRepositories(): Repositories {
  return {
    appUsers: new MysqlAppUserRepository(),
    accounts: new MysqlAccountRepository(),
    transactions: new MysqlTransactionRepository(),
    categories: new MysqlCategoryRepository(),
    taxSections: new MysqlTaxSectionRepository(),
    taxTags: new MysqlTaxTagRepository(),
    userSettings: new MysqlUserSettingRepository(),
    syncRuns: new MysqlSyncRunRepository(),
    bankConnections: new MysqlBankConnectionRepository(),
  };
}
