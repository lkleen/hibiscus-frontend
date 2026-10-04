import { Routes } from '@angular/router';
import { TransactionsComponent } from './transactions.component';
import { TRANSACTIONS_TABS, TransactionsTab } from './transactions-tabs';

const firstTab: TransactionsTab | undefined = TRANSACTIONS_TABS[0];
if (!firstTab) throw new Error('TRANSACTIONS_TABS must contain at least one tab');

/** Mounted at `/:locale/transactions`: the shell with one lazy child route per tab. */
export const TRANSACTIONS_ROUTES: Routes = [
  {
    path: '',
    component: TransactionsComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: firstTab.path },
      ...TRANSACTIONS_TABS.map((tab: TransactionsTab) => ({
        path: tab.path,
        loadComponent: tab.loadComponent,
      })),
    ],
  },
];
