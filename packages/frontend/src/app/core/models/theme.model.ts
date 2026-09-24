export type ThemeName = 'light' | 'dark';

export const SUPPORTED_THEMES: readonly ThemeName[] = ['light', 'dark'];

export const THEME_LABELS: Record<ThemeName, string> = {
  light: 'Light',
  dark: 'Dark',
};
