import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { TaxProfile } from '@hibiscus-frontend/shared/contracts/user-settings';
import { TaxTagDialogs } from '../../../core/tax/tax-tag-dialog/tax-tag-dialogs';
import { CategoryDialogs } from '../../categories/category-dialogs';
import { account, transactionsResponse } from '../../transactions/testing/transaction-fixture';
import { TransactionDialogs } from '../../transactions/transaction-dialogs';
import { TransactionsStore } from '../../transactions/transactions.store';
import { TaxReturnStore } from '../tax-return.store';

/** What the feature shell provides, plus HTTP testing and a router. */
export function taxReturnProviders(): (Provider | EnvironmentProviders)[] {
  return [
    provideHttpClient(),
    provideHttpClientTesting(),
    provideRouter([]),
    TransactionsStore,
    TransactionDialogs,
    CategoryDialogs,
    TaxTagDialogs,
    TaxReturnStore,
  ];
}

/** A profile with every question unanswered; override what a test cares about. */
export function taxProfile(overrides: Partial<TaxProfile['situations']> = {}): TaxProfile {
  return {
    situations: {
      employed: null,
      children: null,
      household: null,
      rental: null,
      donations: null,
      ...overrides,
    },
    hintDismissedYear: null,
  };
}

export interface TaxLoad {
  readonly accounts?: readonly AccountRow[];
  readonly transactions?: readonly TransactionRow[];
  readonly categories?: readonly CategoryRow[];
  /** The stored tax tags (`GET /api/tax-tags`); none by default. */
  readonly tags?: readonly TaxTag[];
  readonly profile?: TaxProfile;
}

/** Answers the requests of the transactions store, the tax tags and the tax profile. */
export function flushTaxLoad(http: HttpTestingController, load: TaxLoad = {}): void {
  http.expectOne('/api/accounts').flush(load.accounts ?? [account({ id: 1 })]);
  http.expectOne('/api/transactions').flush(transactionsResponse([...(load.transactions ?? [])]));
  http.expectOne('/api/categories').flush(load.categories ?? []);
  http.expectOne('/api/tax-tags').flush(load.tags ?? []);
  http.expectOne('/api/settings/tax-profile').flush(load.profile ?? taxProfile());
}
