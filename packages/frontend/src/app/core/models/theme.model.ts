export type ThemeName = 'default' | 'greenbar' | 'vault' | 'private' | 'telex';

export const SUPPORTED_THEMES: readonly ThemeName[] = [
  'default',
  'greenbar',
  'vault',
  'private',
  'telex',
];

export const THEME_LABELS: Record<ThemeName, string> = {
  default: 'Default',
  greenbar: 'Greenbar',
  vault: 'Vault',
  private: 'Private Ledger',
  telex: 'Telex',
};
