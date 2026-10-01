import { Routes } from '@angular/router';
import { SettingsComponent } from './settings.component';
import { SETTINGS_TABS, SettingsTab } from './settings-tabs';

const firstTab: SettingsTab | undefined = SETTINGS_TABS[0];
if (!firstTab) throw new Error('SETTINGS_TABS must contain at least one tab');

/** Mounted at `/:locale/settings`: the shell with one lazy child route per tab. */
export const SETTINGS_ROUTES: Routes = [
  {
    path: '',
    component: SettingsComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: firstTab.path },
      ...SETTINGS_TABS.map((tab: SettingsTab) => ({
        path: tab.path,
        loadComponent: tab.loadComponent,
      })),
    ],
  },
];
