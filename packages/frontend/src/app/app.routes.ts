import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { supportedLocaleGuard } from './core/guards/supported-locale.guard';
import { LocaleService } from './core/services/locale.service';

/** Bare and unsupported-locale URLs land on the browser's preferred supported locale. */
const redirectToPreferredLocale = (): string =>
  `/${inject(LocaleService).detectPreferred()}/accounts`;

export const routes: Routes = [
  {
    path: ':locale',
    canMatch: [supportedLocaleGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'accounts' },
      {
        path: 'accounts',
        loadComponent: () =>
          import('./features/accounts/accounts.component').then((m) => m.AccountsComponent),
      },
      {
        path: 'transactions',
        loadComponent: () =>
          import('./features/transactions/transactions.component').then(
            (m) => m.TransactionsComponent,
          ),
      },
      {
        path: 'categories',
        loadComponent: () =>
          import('./features/categories/categories.component').then((m) => m.CategoriesComponent),
      },
      {
        path: 'payees',
        loadComponent: () =>
          import('./features/payees/payees.component').then((m) => m.PayeesComponent),
      },
    ],
  },
  { path: '**', redirectTo: redirectToPreferredLocale },
];
