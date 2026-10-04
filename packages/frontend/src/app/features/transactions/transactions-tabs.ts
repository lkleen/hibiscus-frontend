import type { Type } from '@angular/core';
import { TabNavItem } from '../../shared/components/tab-nav/tab-nav.component';

export interface TransactionsTab extends TabNavItem {
  /** `path` is the child route segment: `/:locale/transactions/<path>`. */
  loadComponent: () => Promise<Type<unknown>>;
}

/** Single source for the transactions child routes and the tab bar. The first tab is the default. */
export const TRANSACTIONS_TABS: readonly TransactionsTab[] = [
  {
    path: 'list',
    labelKey: 'transactions.tab.list',
    loadComponent: () =>
      import('./list/transactions-list.component').then((m) => m.TransactionsListComponent),
  },
  {
    path: 'categories',
    labelKey: 'transactions.tab.byCategory',
    loadComponent: () =>
      import('./by-category/transactions-by-category.component').then(
        (m) => m.TransactionsByCategoryComponent,
      ),
  },
];
