import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { LocaleService } from '../services/locale.service';
import { MeService } from '../services/me.service';
import { userErrorOf } from '../utils/user-errors';

/**
 * Any `409` `database-not-configured` means the user must set up their database first (for
 * example after the settings were lost): remember it and go to `/:locale/setup`. The failure still
 * propagates to the caller.
 */
export const databaseNotConfiguredInterceptor: HttpInterceptorFn = (request, next) => {
  const me: MeService = inject(MeService);
  const router: Router = inject(Router);
  const locale: LocaleService = inject(LocaleService);
  return next(request).pipe(
    catchError((failure: unknown) => {
      if (userErrorOf(failure) === 'database-not-configured') {
        if (me.me() !== null) me.markUnconfigured();
        if (!router.url.split(/[?#]/)[0]?.endsWith('/setup')) {
          void router.navigateByUrl(`/${locale.locale()}/setup`);
        }
      }
      return throwError(() => failure);
    }),
  );
};
