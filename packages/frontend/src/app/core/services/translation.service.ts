import { Injectable, inject } from '@angular/core';
import { DICTIONARIES, TranslationKey, TranslationParams } from '../models/translation.model';
import { LocaleService } from './locale.service';

/**
 * `t('key', { name })` resolves a key in the active locale's dictionary and fills `{name}`
 * placeholders. Reads the locale signal, so calls inside templates re-evaluate on locale change.
 * Keys are compile-time checked (see translation.model.ts); a placeholder without a matching
 * param throws instead of rendering a half-filled string.
 */
@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly localeService = inject(LocaleService);

  t(key: TranslationKey, params: TranslationParams = {}): string {
    const template: string = DICTIONARIES[this.localeService.locale()][key];
    return template.replace(/\{(\w+)\}/g, (_match: string, name: string) => {
      if (!(name in params)) throw new Error(`Missing param "${name}" for translation "${key}"`);
      return String(params[name]);
    });
  }
}
