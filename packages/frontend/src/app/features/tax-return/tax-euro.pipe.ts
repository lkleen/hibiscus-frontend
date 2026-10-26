import { Pipe, type PipeTransform } from '@angular/core';
import type { Locale } from '../../core/models/locale.model';

const FORMATS: Map<Locale, Intl.NumberFormat> = new Map<Locale, Intl.NumberFormat>();

/** An amount in euros, in the UI locale (`1.234,50 €` / `€1,234.50`). */
export function formatEuro(value: number, locale: Locale): string {
  let format: Intl.NumberFormat | undefined = FORMATS.get(locale);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' });
    FORMATS.set(locale, format);
  }
  return format.format(value);
}

/** `formatEuro` as a pure pipe: pass the locale signal's value so a locale switch re-renders. */
@Pipe({ name: 'taxEuro' })
export class TaxEuroPipe implements PipeTransform {
  transform(value: number, locale: Locale): string {
    return formatEuro(value, locale);
  }
}
