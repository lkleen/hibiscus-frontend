import type { Type } from '@angular/core';
import type { TableViewId } from '@hibiscus-frontend/shared/contracts/user-settings';
import { TabNavItem } from '../../shared/components/tab-nav/tab-nav.component';

export interface TransactionsTab extends TabNavItem {
  /** `path` is the child route segment: `/:locale/transactions/<path>`. */
  loadComponent: () => Promise<Type<unknown>>;
  /** The density setting this tab's table follows (shared by the View band and the table). */
  densityView: TableViewId;
  /** The tab's table is a tree, so the View band offers its expand/collapse-all controls. */
  hasTree: boolean;
}

/** Single source for the transactions child routes and the tab bar. The first tab is the default. */
export const TRANSACTIONS_TABS: readonly TransactionsTab[] = [
  {
    path: 'list',
    labelKey: 'transactions.tab.list',
    densityView: 'transactions-list',
    hasTree: false,
    loadComponent: () =>
      import('./list/transactions-list.component').then((m) => m.TransactionsListComponent),
  },
  {
    path: 'categories',
    labelKey: 'transactions.tab.byCategory',
    densityView: 'transactions-by-category',
    hasTree: true,
    loadComponent: () =>
      import('./by-category/transactions-by-category.component').then(
        (m) => m.TransactionsByCategoryComponent,
      ),
  },
];

/** The density view of the tab at `path`, so a tab's table never repeats the literal. */
export function tabDensityView(path: TransactionsTab['path']): TableViewId {
  const tab: TransactionsTab | undefined = TRANSACTIONS_TABS.find(
    (candidate: TransactionsTab): boolean => candidate.path === path,
  );
  if (!tab) throw new Error(`no transactions tab with path "${path}"`);
  return tab.densityView;
}
