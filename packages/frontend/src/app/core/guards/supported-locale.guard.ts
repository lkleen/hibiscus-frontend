import { CanMatchFn, UrlSegment } from '@angular/router';
import { isSupportedLocale } from '../models/locale.model';

/** Matches `/:locale/...` only for supported locales; anything else falls through to the redirect. */
export const supportedLocaleGuard: CanMatchFn = (_route, segments: UrlSegment[]): boolean => {
  const locale: string | undefined = segments[0]?.path;
  return locale !== undefined && isSupportedLocale(locale);
};
