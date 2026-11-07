import { describe, expect, it } from 'vitest';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import { DemoAccountRepository } from './demo-account-repository';
import { createDemoStore } from './demo-store';
import { createTestDataset } from './demo-test-dataset.fixture';

describe('DemoAccountRepository', () => {
  it('lists the accounts ordered by bezeichnung', async () => {
    const accounts: AccountRow[] = await new DemoAccountRepository(
      createDemoStore(createTestDataset()),
    ).list();
    expect(accounts.map((account: AccountRow) => account.bezeichnung)).toEqual([
      'Girokonto',
      'Tagesgeld',
    ]);
  });
});
