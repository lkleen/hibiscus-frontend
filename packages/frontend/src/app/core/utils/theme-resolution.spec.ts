import {
  THEME_STORAGE_KEY,
  THEME_STORAGE_TTL_MS,
  persistTheme,
  resolveInitialPreference,
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

  describe('resolveInitialPreference', () => {
    it('returns the stored preference when it is fresh', () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ theme: 'vault', darkMode: true, savedAt: Date.now() }),
      );

      expect(resolveInitialPreference()).toEqual({ theme: 'vault', darkMode: true });
    });

    it('migrates a legacy light/dark-only stored value to the default identity', () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ theme: 'dark', savedAt: Date.now() }),
      );

      expect(resolveInitialPreference()).toEqual({ theme: 'default', darkMode: true });
    });

    it('falls back to default + OS preference when nothing is stored', () => {
      mockMatchMedia(true);

      expect(resolveInitialPreference()).toEqual({ theme: 'default', darkMode: true });
    });

    it('falls back to OS preference when the stored entry is older than the TTL', () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({
          theme: 'vault',
          darkMode: true,
          savedAt: Date.now() - THEME_STORAGE_TTL_MS - 1,
        }),
      );
      mockMatchMedia(false);

      expect(resolveInitialPreference()).toEqual({ theme: 'default', darkMode: false });
    });

    it('falls back to OS preference when the stored value is corrupt JSON', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, '{not json');

      expect(resolveInitialPreference()).toEqual({ theme: 'default', darkMode: false });
    });

    it('falls back to OS preference when the stored theme name is invalid', () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ theme: 'sepia', darkMode: false, savedAt: Date.now() }),
      );

      expect(resolveInitialPreference()).toEqual({ theme: 'default', darkMode: false });
    });
  });

  describe('persistTheme', () => {
    it('writes the theme, dark-mode flag, and a fresh timestamp to localStorage', () => {
      const before = Date.now();

      persistTheme({ theme: 'telex', darkMode: true });

      const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string) as {
        theme: string;
        darkMode: boolean;
        savedAt: number;
      };
      expect(parsed.theme).toBe('telex');
      expect(parsed.darkMode).toBe(true);
      expect(parsed.savedAt).toBeGreaterThanOrEqual(before);
    });
  });
});
