import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlSegment, UrlTree } from '@angular/router';
import type { Me } from '@hibiscus-frontend/shared/contracts/user';
import { Observable, map } from 'rxjs';
import { MeService } from '../services/me.service';

/** The first segment is the locale; `supportedLocaleGuard` runs before and vouches for it. */
function localeOf(segments: UrlSegment[]): string {
  const locale: string | undefined = segments[0]?.path;
  if (locale === undefined) throw new Error('Route matched without a locale segment');
  return locale;
}

/** Whether both the database and the key are set up. */
function isSetUp(me: Me): boolean {
  return me.database === 'configured' && me.key === 'configured';
}

/** The app pages: a user without a database or a key is sent to `/:locale/setup`. */
export const databaseConfiguredGuard: CanMatchFn = (
  _route,
  segments: UrlSegment[],
): Observable<boolean | UrlTree> => {
  const router: Router = inject(Router);
  return inject(MeService)
    .load()
    .pipe(
      map(
        (me: Me): boolean | UrlTree =>
          isSetUp(me) || router.createUrlTree([localeOf(segments), 'setup']),
      ),
    );
};

/** The setup page: once the database and the key exist it sends the user on to the app. */
export const setupGuard: CanMatchFn = (
  _route,
  segments: UrlSegment[],
): Observable<boolean | UrlTree> => {
  const router: Router = inject(Router);
  return inject(MeService)
    .load()
    .pipe(
      map(
        (me: Me): boolean | UrlTree =>
          !isSetUp(me) || router.createUrlTree([localeOf(segments), 'accounts']),
      ),
    );
};
