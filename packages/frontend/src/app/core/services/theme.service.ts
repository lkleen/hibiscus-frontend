import { Injectable, signal } from '@angular/core';
import { SUPPORTED_THEMES, ThemeName } from '../models/theme.model';
import { persistTheme, resolveInitialTheme } from '../utils/theme-resolution';

/**
 * Owns the active theme: `theme-light` / `theme-dark` on <html>, persisted to localStorage.
 *
 * Scoping note: this app has exactly two themes, `light` and `dark`, and `dark` IS this app's
 * dark mode — there's no third theme that would ever need an independent dark variant, so unlike
 * the general claude-config theming contract, this service does not implement a separate
 * `.dark-mode` class. Each theme's SCSS sets `color-scheme` directly instead. See
 * packages/frontend/CLAUDE.md.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly currentTheme = signal<ThemeName>(this.readInitialTheme());

  constructor() {
    // The inline script in index.html already applied the correct class before bootstrap; this
    // just makes sure the classList still agrees with the signal (e.g. if it wasn't set yet).
    this.applyClass(this.currentTheme());
  }

  setTheme(name: ThemeName): void {
    this.currentTheme.set(name);
    this.applyClass(name);
    persistTheme(name);
  }

  toggleTheme(): void {
    this.setTheme(this.currentTheme() === 'light' ? 'dark' : 'light');
  }

  private readInitialTheme(): ThemeName {
    const root = document.documentElement;
    const fromDom = SUPPORTED_THEMES.find((name) => root.classList.contains(`theme-${name}`));
    return fromDom ?? resolveInitialTheme();
  }

  private applyClass(name: ThemeName): void {
    const root = document.documentElement;
    for (const n of SUPPORTED_THEMES) root.classList.remove(`theme-${n}`);
    root.classList.add(`theme-${name}`);
  }
}
