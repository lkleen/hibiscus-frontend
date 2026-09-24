import { SUPPORTED_THEMES, ThemeName } from '../models/theme.model';

export const THEME_STORAGE_KEY = 'bm-theme';
export const THEME_STORAGE_TTL_MS = 60 * 60 * 1000;

export interface ThemePreference {
  theme: ThemeName;
  darkMode: boolean;
}

interface StoredPreference {
  theme: string;
  darkMode?: boolean;
  savedAt: number;
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (SUPPORTED_THEMES as readonly string[]).includes(value);
}

function readStoredPreference(): ThemePreference | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPreference>;
    if (typeof parsed.savedAt !== 'number') return null;
    const age = Date.now() - parsed.savedAt;
    if (age < 0 || age >= THEME_STORAGE_TTL_MS) return null;

    // Pre-rework storage used `theme: 'light' | 'dark'` as the identity itself. Both map to the
    // 'default' identity, carrying the light/dark distinction over to the new independent axis.
    if (parsed.theme === 'light') return { theme: 'default', darkMode: false };
    if (parsed.theme === 'dark') return { theme: 'default', darkMode: true };

    if (!isThemeName(parsed.theme)) return null;
    const darkMode = typeof parsed.darkMode === 'boolean' ? parsed.darkMode : false;
    return { theme: parsed.theme, darkMode };
  } catch {
    return null;
  }
}

function osPreferredDarkMode(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Resolves the theme identity + dark-mode axis that should be active: a fresh (<1h old) stored
 * preference, else the 'default' identity with OS-preferred dark mode. This algorithm is
 * duplicated as plain JS in the inline FOUC-prevention script in index.html's <head> — that copy
 * runs before Angular bootstraps and cannot import this module. Both copies must change together.
 */
export function resolveInitialPreference(): ThemePreference {
  return readStoredPreference() ?? { theme: 'default', darkMode: osPreferredDarkMode() };
}

export function persistTheme(pref: ThemePreference): void {
  try {
    const stored: StoredPreference = {
      theme: pref.theme,
      darkMode: pref.darkMode,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Preference still applies for this session even if it can't be persisted.
  }
}
