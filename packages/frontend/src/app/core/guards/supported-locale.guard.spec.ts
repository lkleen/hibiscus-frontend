import { Route, UrlSegment } from '@angular/router';
import { supportedLocaleGuard } from './supported-locale.guard';

function matches(...paths: string[]): boolean {
  const segments: UrlSegment[] = paths.map((path) => new UrlSegment(path, {}));
  return supportedLocaleGuard({} as Route, segments) as boolean;
}

describe('supportedLocaleGuard', () => {
  it('matches supported locales', () => {
    expect(matches('en', 'accounts')).toBe(true);
    expect(matches('de')).toBe(true);
  });

  it('rejects unsupported locales and non-locale first segments', () => {
    expect(matches('fr', 'accounts')).toBe(false);
    expect(matches('accounts')).toBe(false);
  });
});
