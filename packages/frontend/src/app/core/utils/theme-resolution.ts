import { SUPPORTED_THEMES, ThemeName } from '../models/theme.model';

export const THEME_STORAGE_KEY = 'bm-theme';
export const THEME_STORAGE_TTL_MS = 60 * 60 * 1000;

interface StoredTheme {
  theme: ThemeName;
  savedAt: number;
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (SUPPORTED_THEMES as readonly string[]).includes(value);
}

function readStoredTheme(): ThemeName | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTheme>;
    if (!isThemeName(parsed.theme) || typeof parsed.savedAt !== 'number') return null;
    const age = Date.now() - parsed.savedAt;
    if (age < 0 || age >= THEME_STORAGE_TTL_MS) return null;
    return parsed.theme;
  } catch {
    return null;
  }
}

function osPreferredTheme(): ThemeName {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Resolves which theme should be active: a fresh (<1h old) stored preference, else the OS
 * preference. This algorithm is duplicated as plain JS in the inline FOUC-prevention script in
 * index.html's <head> — that copy runs before Angular bootstraps and cannot import this module.
 * Both copies must change together.
 */
export function resolveInitialTheme(): ThemeName {
  return readStoredTheme() ?? osPreferredTheme();
}

export function persistTheme(theme: ThemeName): void {
  try {
    const stored: StoredTheme = { theme, savedAt: Date.now() };
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Theme still applies for this session even if it can't be persisted.
  }
}
