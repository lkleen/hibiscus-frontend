import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { databaseConfiguredGuard, setupGuard } from './core/guards/database-configured.guard';
import { supportedLocaleGuard } from './core/guards/supported-locale.guard';
import { LocaleService } from './core/services/locale.service';

/** Bare and unsupported-locale URLs land on the browser's preferred supported locale. */
const redirectToPreferredLocale = (): string =>
  `/${inject(LocaleService).detectPreferred()}/accounts`;

export const routes: Routes = [
  {
    // First run: the guard sends users with a configured database on to the app.
    path: ':locale/setup',
    canMatch: [supportedLocaleGuard, setupGuard],
    loadComponent: () => import('./features/setup/setup.component').then((m) => m.SetupComponent),
  },
  {
    // Everything else needs the user's Hibiscus database: without it the guard redirects to setup.
    path: ':locale',
    canMatch: [supportedLocaleGuard, databaseConfiguredGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'accounts' },
      {
        path: 'accounts',
        loadComponent: () =>
          import('./features/accounts/accounts.component').then((m) => m.AccountsComponent),
      },
      {
        path: 'transactions',
        loadChildren: () =>
          import('./features/transactions/transactions.routes').then((m) => m.TRANSACTIONS_ROUTES),
      },
      {
        path: 'categories',
        loadComponent: () =>
          import('./features/categories/categories.component').then((m) => m.CategoriesComponent),
      },
      {
        path: 'settings',
        loadChildren: () =>
          import('./features/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: redirectToPreferredLocale },
];
