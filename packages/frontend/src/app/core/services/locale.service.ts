import { Location } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Locale, isSupportedLocale } from '../models/locale.model';

/** The locale is the first URL segment (`/:locale/...`), or null if it isn't a supported one. */
function localeFromPath(path: string): Locale | null {
  const segment: string = path.split(/[/?#]/).find((part) => part !== '') ?? '';
  return isSupportedLocale(segment) ? segment : null;
}

/**
 * Owns the active UI locale. The URL (`/:locale/...`) is the single source of truth; `locale` is a
 * signal mirror of it so templates and the TranslationService stay reactive. Bare URLs (no locale
 * segment) are redirected by the router to `detectPreferred()`, see app.routes.ts.
 */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly router = inject(Router);

  readonly locale = signal<Locale>(
    localeFromPath(inject(Location).path()) ?? this.detectPreferred(),
  );

  constructor() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.locale.set(this.currentLocaleFromUrl()));

    effect(() => {
      document.documentElement.lang = this.locale();
    });
  }

  /** Browser language if supported, otherwise English. Used only when the URL has no locale. */
  detectPreferred(): Locale {
    return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  currentLocaleFromUrl(): Locale {
    const url: string = this.router.url;
    const locale: Locale | null = localeFromPath(url);
    if (!locale) throw new Error(`URL has no supported locale segment: ${url}`);
    return locale;
  }

  /** Swaps the locale segment of the current URL, keeping path, query params and fragment. */
  setLocale(next: Locale): void {
    const current: Locale = this.currentLocaleFromUrl();
    const rest: string = this.router.url.slice(`/${current}`.length);
    void this.router.navigateByUrl(`/${next}${rest}`);
  }
}
