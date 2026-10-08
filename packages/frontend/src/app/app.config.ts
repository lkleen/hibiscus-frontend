import { provideHttpClient, withFetch } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { ApplicationConfig, effect, inject, provideAppInitializer } from '@angular/core';
import { provideRouter } from '@angular/router';
import Aura from '@primeuix/themes/aura';
import { PrimeNG, providePrimeNG } from 'primeng/config';
import { routes } from './app.routes';
import { TableDensityService } from './core/services/table-density.service';
import { TranslationService } from './core/services/translation.service';
import { primengTranslation } from './core/utils/primeng-translation';

// `en` ships with Angular; `de` is needed for the locale-aware number pipes (see LocaleService).
registerLocaleData(localeDe);

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withFetch()),
    providePrimeNG({
      // `.dark-mode` (not the default `'system'`, which reads prefers-color-scheme) keeps the
      // dark axis under ThemeService's control across all five theme identities; `cssLayer` lets
      // app CSS outrank PrimeNG's own rules without specificity hacks.
      theme: { preset: Aura, options: { darkModeSelector: '.dark-mode', cssLayer: true } },
    }),
    // Keeps PrimeNG's own strings (filter menus, paginator ARIA text) in the active locale. This
    // is app-wide state, not a component's, so it's wired here rather than in a component: the
    // initializer runs once in the root injector's injection context, and the `effect()` it
    // creates there lives for the app's lifetime, re-running `primengTranslation()` — which reads
    // the locale internally via `TranslationService.t()` — on every later locale switch.
    provideAppInitializer(() => {
      const primeng = inject(PrimeNG);
      const i18n = inject(TranslationService);
      effect(() => primeng.setTranslation(primengTranslation(i18n)));
    }),
    // Instantiates TableDensityService at startup so its `table-density-*` class is on <html> on
    // every page, not only once a component happens to inject the service.
    provideAppInitializer(() => {
      inject(TableDensityService);
    }),
  ],
};
