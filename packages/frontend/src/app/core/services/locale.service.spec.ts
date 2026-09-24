import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { supportedLocaleGuard } from '../guards/supported-locale.guard';
import { LocaleService } from './locale.service';

@Component({ selector: 'app-stub', template: '' })
class StubComponent {}

describe('LocaleService', () => {
  let router: Router;
  let service: LocaleService;

  beforeEach(() => {
    document.documentElement.lang = '';
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: ':locale',
            canMatch: [supportedLocaleGuard],
            children: [{ path: 'accounts', component: StubComponent }],
          },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    service = TestBed.inject(LocaleService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.lang = '';
  });

  it('follows the locale segment of the URL after each navigation', async () => {
    await router.navigateByUrl('/de/accounts');
    expect(service.locale()).toBe('de');
    expect(service.currentLocaleFromUrl()).toBe('de');

    await router.navigateByUrl('/en/accounts');
    expect(service.locale()).toBe('en');
  });

  it('throws from currentLocaleFromUrl when the URL has no supported locale (guarded route rejects)', async () => {
    await router.navigateByUrl('/fr/accounts').catch(() => undefined);

    expect(() => service.currentLocaleFromUrl()).toThrow(/no supported locale/);
  });

  it('keeps <html lang> in sync with the locale', async () => {
    await router.navigateByUrl('/de/accounts');
    TestBed.tick();

    expect(document.documentElement.lang).toBe('de');
  });

  it('setLocale swaps the locale segment and keeps path, query params and fragment', async () => {
    await router.navigateByUrl('/de/accounts?accountId=3#top');

    service.setLocale('en');

    await vi.waitFor(() => expect(router.url).toBe('/en/accounts?accountId=3#top'));
    expect(service.locale()).toBe('en');
  });

  it('detects German from the browser language and defaults to English otherwise', () => {
    vi.stubGlobal('navigator', { language: 'de-AT' });
    expect(service.detectPreferred()).toBe('de');

    vi.stubGlobal('navigator', { language: 'fr-FR' });
    expect(service.detectPreferred()).toBe('en');
  });
});
