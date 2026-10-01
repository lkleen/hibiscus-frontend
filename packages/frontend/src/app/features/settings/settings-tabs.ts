import type { Type } from '@angular/core';
import { TranslationKey } from '../../core/models/translation.model';

export interface SettingsTab {
  /** Child route segment: `/:locale/settings/<path>`. */
  path: string;
  labelKey: TranslationKey;
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
