import { Routes } from '@angular/router';
import { TaxReturnComponent } from './tax-return.component';
import { taxYearGuard } from './tax-year';

/** Mounted at `/:locale/tax-return`: the year picker, and the wizard per year. */
export const TAX_RETURN_ROUTES: Routes = [
  {
    path: '',
    component: TaxReturnComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./year-picker/tax-year-picker.component').then((m) => m.TaxYearPickerComponent),
      },
      {
        path: ':year',
        canActivate: [taxYearGuard],
        loadComponent: () =>
          import('./wizard/tax-wizard.component').then((m) => m.TaxWizardComponent),
      },
    ],
  },
];
