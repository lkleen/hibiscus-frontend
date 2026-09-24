import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';
import { Locale } from './locale.model';

/** `en.json` is the source of truth for the key set; `de.json` must provide every key. */
export type TranslationKey = keyof typeof en;

export type Dictionary = Record<TranslationKey, string>;

export type TranslationParams = Record<string, string | number>;

export const DICTIONARIES: Record<Locale, Dictionary> = { en, de };
