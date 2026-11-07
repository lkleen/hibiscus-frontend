import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { AccountRepository } from '../repositories/konto';
import { compareText } from './demo-store';
import type { DemoStore } from './demo-store';

/** `konto` of the demo data. */
export class DemoAccountRepository implements AccountRepository {
  constructor(private readonly store: DemoStore) {}

  async list(): Promise<AccountRow[]> {
    return this.store.accounts
      .map((account: AccountRow): AccountRow => ({ ...account }))
      .sort(
        (a: AccountRow, b: AccountRow): number =>
          compareText(a.bezeichnung, b.bezeichnung) || a.id - b.id,
      );
  }
}
