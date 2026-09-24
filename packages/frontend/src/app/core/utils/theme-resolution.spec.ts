import {
  THEME_STORAGE_KEY,
  THEME_STORAGE_TTL_MS,
  persistTheme,
  resolveInitialTheme,
} from './theme-resolution';
import { installLocalStorageMock } from './testing/local-storage-mock';

function mockMatchMedia(prefersDark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && prefersDark,
      media: query,
    }),
  });
}

describe('theme-resolution', () => {
  beforeEach(() => {
    installLocalStorageMock();
    mockMatchMedia(false);
  });

  describe('resolveInitialTheme', () => {
    it('returns the stored theme when it is fresh', () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ theme: 'dark', savedAt: Date.now() }),
      );

      expect(resolveInitialTheme()).toBe('dark');
    });

    it('falls back to the OS preference when nothing is stored', () => {
      mockMatchMedia(true);

      expect(resolveInitialTheme()).toBe('dark');
    });

    it('falls back to the OS preference when the stored entry is older than the TTL', () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ theme: 'dark', savedAt: Date.now() - THEME_STORAGE_TTL_MS - 1 }),
      );
      mockMatchMedia(false);

      expect(resolveInitialTheme()).toBe('light');
    });

    it('falls back to the OS preference when the stored value is corrupt JSON', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, '{not json');

      expect(resolveInitialTheme()).toBe('light');
    });

    it('falls back to the OS preference when the stored theme name is invalid', () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ theme: 'sepia', savedAt: Date.now() }),
      );

      expect(resolveInitialTheme()).toBe('light');
    });
  });

  describe('persistTheme', () => {
    it('writes the theme and a fresh timestamp to localStorage', () => {
      const before = Date.now();

      persistTheme('dark');

      const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string) as { theme: string; savedAt: number };
      expect(parsed.theme).toBe('dark');
      expect(parsed.savedAt).toBeGreaterThanOrEqual(before);
    });
  });
});
