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

  it('seeds currentTheme from a theme class already present on <html>', () => {
    document.documentElement.classList.add('theme-dark');

    const service = TestBed.inject(ThemeService);

    expect(service.currentTheme()).toBe('dark');
  });

  it('setTheme updates the signal, the <html> classList, and persists the choice', () => {
    document.documentElement.classList.add('theme-light');
    const service = TestBed.inject(ThemeService);

    service.setTheme('dark');

    expect(service.currentTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);

    const stored = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) as string) as {
      theme: string;
    };
    expect(stored.theme).toBe('dark');
  });

  it('toggleTheme flips between light and dark', () => {
    document.documentElement.classList.add('theme-light');
    const service = TestBed.inject(ThemeService);

    service.toggleTheme();
    expect(service.currentTheme()).toBe('dark');

    service.toggleTheme();
    expect(service.currentTheme()).toBe('light');
  });
});
