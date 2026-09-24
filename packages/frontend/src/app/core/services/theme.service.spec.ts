import { TestBed } from '@angular/core/testing';
import { installLocalStorageMock } from '../utils/testing/local-storage-mock';
import { THEME_STORAGE_KEY } from '../utils/theme-resolution';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    installLocalStorageMock();
    document.documentElement.className = '';
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    document.documentElement.className = '';
  });

  it('seeds currentTheme and darkMode from classes already present on <html>', () => {
    document.documentElement.classList.add('theme-vault', 'dark-mode');

    const service = TestBed.inject(ThemeService);

    expect(service.currentTheme()).toBe('vault');
    expect(service.darkMode()).toBe(true);
  });

  it('setTheme updates the signal, the <html> classList, and persists the choice', () => {
    document.documentElement.classList.add('theme-default');
    const service = TestBed.inject(ThemeService);

    service.setTheme('greenbar');

    expect(service.currentTheme()).toBe('greenbar');
    expect(document.documentElement.classList.contains('theme-greenbar')).toBe(true);
    expect(document.documentElement.classList.contains('theme-default')).toBe(false);

    const stored = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) as string) as {
      theme: string;
    };
    expect(stored.theme).toBe('greenbar');
  });

  it('setDarkMode toggles .dark-mode independently of the theme identity', () => {
    document.documentElement.classList.add('theme-private');
    const service = TestBed.inject(ThemeService);

    service.setDarkMode(true);

    expect(service.darkMode()).toBe(true);
    expect(service.currentTheme()).toBe('private');
    expect(document.documentElement.classList.contains('theme-private')).toBe(true);
    expect(document.documentElement.classList.contains('dark-mode')).toBe(true);

    const stored = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) as string) as {
      theme: string;
      darkMode: boolean;
    };
    expect(stored).toEqual(expect.objectContaining({ theme: 'private', darkMode: true }));
  });

  it('toggleDarkMode flips the axis', () => {
    document.documentElement.classList.add('theme-default');
    const service = TestBed.inject(ThemeService);

    service.toggleDarkMode();
    expect(service.darkMode()).toBe(true);

    service.toggleDarkMode();
    expect(service.darkMode()).toBe(false);
  });
});
