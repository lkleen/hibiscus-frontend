import { Injectable, signal } from '@angular/core';
import { SUPPORTED_THEMES, ThemeName } from '../models/theme.model';
import { persistTheme, resolveInitialPreference } from '../utils/theme-resolution';

/**
 * Owns the active theme identity (`theme-[name]` on <html>) and the independent dark-mode axis
 * (`.dark-mode` on <html>, coexisting with the identity class), both persisted to localStorage.
 * See packages/frontend/CLAUDE.md and claude-config/frontend-theming.md for the general contract.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly currentTheme = signal<ThemeName>(this.readInitialTheme());
  readonly darkMode = signal<boolean>(this.readInitialDarkMode());

  constructor() {
    // The inline script in index.html already applied the correct classes before bootstrap; this
    // just makes sure the classList still agrees with the signals (e.g. if it wasn't set yet).
    this.applyClasses(this.currentTheme(), this.darkMode());
  }

  setTheme(name: ThemeName): void {
    this.currentTheme.set(name);
    this.applyClasses(name, this.darkMode());
    this.persist();
  }

  setDarkMode(dark: boolean): void {
    this.darkMode.set(dark);
    this.applyClasses(this.currentTheme(), dark);
    this.persist();
  }

  toggleDarkMode(): void {
    this.setDarkMode(!this.darkMode());
  }

  private readInitialTheme(): ThemeName {
    const root = document.documentElement;
    const fromDom = SUPPORTED_THEMES.find((name) => root.classList.contains(`theme-${name}`));
    return fromDom ?? resolveInitialPreference().theme;
  }

  private readInitialDarkMode(): boolean {
    const root = document.documentElement;
    const themeAlreadyApplied = SUPPORTED_THEMES.some((name) =>
      root.classList.contains(`theme-${name}`),
    );
    if (themeAlreadyApplied) {
      return root.classList.contains('dark-mode');
    }
    return resolveInitialPreference().darkMode;
  }

  private applyClasses(name: ThemeName, dark: boolean): void {
    const root = document.documentElement;
    for (const n of SUPPORTED_THEMES) root.classList.remove(`theme-${n}`);
    root.classList.add(`theme-${name}`);
    root.classList.toggle('dark-mode', dark);
  }

  private persist(): void {
    persistTheme({ theme: this.currentTheme(), darkMode: this.darkMode() });
  }
}
