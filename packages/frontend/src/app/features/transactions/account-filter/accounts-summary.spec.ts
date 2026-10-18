import { TestBed } from '@angular/core/testing';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import { TranslationService } from '../../../core/services/translation.service';
import { account } from '../testing/transaction-fixture';
import { accountsSummary } from './accounts-summary';

const ACCOUNTS: AccountRow[] = [
  account({ id: 1, bezeichnung: 'Checking' }),
  account({ id: 2, bezeichnung: 'Savings' }),
  account({ id: 3, bezeichnung: 'Joint' }),
];

describe('accountsSummary', () => {
  function summary(excluded: number[]): string {
    return accountsSummary({
      accounts: ACCOUNTS,
      excludedIds: new Set<number>(excluded),
      i18n: TestBed.inject(TranslationService),
    });
  }

  it('says all accounts when none is excluded', () => {
    expect(summary([])).toBe('All accounts');
  });

  it('names the only remaining account', () => {
    expect(summary([1, 3])).toBe('Savings');
  });

  it('counts several remaining accounts', () => {
    expect(summary([2])).toBe('2 of 3 accounts');
  });

  it('says no accounts when all are excluded', () => {
    expect(summary([1, 2, 3])).toBe('No accounts');
  });
});
