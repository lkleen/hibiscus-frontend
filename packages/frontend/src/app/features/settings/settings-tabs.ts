import type { Type } from '@angular/core';
import { TabNavItem } from '../../shared/components/tab-nav/tab-nav.component';

export interface SettingsTab extends TabNavItem {
  /** `path` is the child route segment: `/:locale/settings/<path>`. */
  loadComponent: () => Promise<Type<unknown>>;
}

/** Single source for the settings child routes and the tab bar. The first tab is the default. */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  {
    path: 'date-presets',
    labelKey: 'settings.tab.datePresets',
    loadComponent: () =>
      import('./date-presets/date-presets.component').then((m) => m.DatePresetsComponent),
  },
];
