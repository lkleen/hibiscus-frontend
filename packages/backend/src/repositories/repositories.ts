import type { AppUserRepository } from './app-user';
import type { BankConnectionRepository } from './bank-connection';
import type { AccountRepository } from './konto';
import type { SyncRunRepository } from './sync-run';
import type { TaxSectionRepository } from './tax-section';
import type { TaxTagRepository } from './tax-tag';
import type { TransactionRepository } from './umsatz';
import type { CategoryRepository } from './umsatztyp';
import type { UserSettingRepository } from './user-setting';

/**
 * Every repository the app works with, built once at startup for the configured data source
 * (`DATA_SOURCE`: MariaDB or the demo data) and handed to the routers and services, which take
 * only the members they use (`Pick<Repositories, …>`).
 */
export interface Repositories {
  readonly appUsers: AppUserRepository;
  readonly accounts: AccountRepository;
  readonly transactions: TransactionRepository;
  readonly categories: CategoryRepository;
  readonly taxSections: TaxSectionRepository;
  readonly taxTags: TaxTagRepository;
  readonly userSettings: UserSettingRepository;
  readonly syncRuns: SyncRunRepository;
  readonly bankConnections: BankConnectionRepository;
}
