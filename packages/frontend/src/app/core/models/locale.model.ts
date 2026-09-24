export type Locale = 'en' | 'de';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'de'];

export function isSupportedLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}
