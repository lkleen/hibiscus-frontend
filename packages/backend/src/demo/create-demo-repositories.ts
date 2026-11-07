import type { Repositories } from '../repositories/repositories';
import { DemoAccountRepository } from './demo-account-repository';
import { DemoAppUserRepository } from './demo-app-user-repository';
import { DemoBankConnectionRepository } from './demo-bank-connection-repository';
import { DemoCategoryRepository } from './demo-category-repository';
import type { DemoDataset } from './demo-dataset';
import { createDemoStore } from './demo-store';
import type { DemoStore } from './demo-store';
import { DemoSyncRunRepository } from './demo-sync-run-repository';
import { DemoTaxSectionRepository } from './demo-tax-section-repository';
import { DemoTaxTagRepository } from './demo-tax-tag-repository';
import { DemoTransactionRepository } from './demo-transaction-repository';
import { DemoUserSettingRepository } from './demo-user-setting-repository';

/** The demo repositories and the store they share (for `DemoUserDatabases`). */
export interface DemoRepositories {
  readonly repositories: Repositories;
  readonly store: DemoStore;
}

/** Every repository working on one fresh store filled from `dataset` (which stays unchanged). */
export function createDemoRepositories(dataset: DemoDataset): DemoRepositories {
  const store: DemoStore = createDemoStore(dataset);
  const repositories: Repositories = {
    appUsers: new DemoAppUserRepository(store),
    accounts: new DemoAccountRepository(store),
    transactions: new DemoTransactionRepository(store),
    categories: new DemoCategoryRepository(store),
    taxSections: new DemoTaxSectionRepository(store),
    taxTags: new DemoTaxTagRepository(store),
    userSettings: new DemoUserSettingRepository(store),
    syncRuns: new DemoSyncRunRepository(store),
    bankConnections: new DemoBankConnectionRepository(store),
  };
  return { repositories, store };
}
