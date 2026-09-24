import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Component } from '@angular/core';
import { DICTIONARIES } from '../models/translation.model';
import { LocaleService } from './locale.service';
import { TranslationService } from './translation.service';

@Component({ selector: 'app-stub', template: '' })
class StubComponent {}

describe('TranslationService', () => {
  let router: Router;
  let service: TranslationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: ':locale/accounts', component: StubComponent }])],
    });
    router = TestBed.inject(Router);
    service = TestBed.inject(TranslationService);
  });

  it('resolves keys in the active locale and re-resolves when the locale changes', async () => {
    await router.navigateByUrl('/en/accounts');
    expect(service.t('nav.accounts')).toBe('Accounts');

    await router.navigateByUrl('/de/accounts');
    expect(service.t('nav.accounts')).toBe('Konten');
  });

  it('fills placeholders from params', async () => {
    await router.navigateByUrl('/en/accounts');

    expect(service.t('userMenu.triggerLoggedIn', { user: 'lars' })).toBe(
      'User menu, logged in as lars',
    );
  });

  it('throws when a placeholder has no matching param', async () => {
    await router.navigateByUrl('/en/accounts');

    expect(() => service.t('userMenu.loggedInAs')).toThrow(/Missing param "user"/);
  });

  it('reads the locale from LocaleService', () => {
    TestBed.inject(LocaleService).locale.set('de');

    expect(service.t('userMenu.language')).toBe('Sprache');
  });
});

describe('dictionaries', () => {
  it('define exactly the same keys and placeholders in every locale', () => {
    const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

    const en: Record<string, string> = DICTIONARIES.en;
    const de: Record<string, string> = DICTIONARIES.de;

    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
    }
  });
});
