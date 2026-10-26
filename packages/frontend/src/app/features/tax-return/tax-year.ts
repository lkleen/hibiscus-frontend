import type { CanActivateFn, UrlTree } from '@angular/router';
import { Router } from '@angular/router';
import { inject } from '@angular/core';

const MIN_YEAR = 1900;
const MAX_YEAR = 9999;

/** The tax year in a route segment (four digits, 1900–9999), or `null` when it is not one. */
export function parseTaxYear(segment: string | null): number | null {
  if (segment === null || !/^\d{4}$/.test(segment)) return null;
  const year = Number(segment);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

/** The year the picker starts on: the last calendar year. */
export function lastCalendarYear(today: Date): number {
  return today.getFullYear() - 1;
}

/** `:year` must be a tax year; anything else goes back to the picker (the parent route). */
export const taxYearGuard: CanActivateFn = (route): boolean | UrlTree => {
  if (parseTaxYear(route.paramMap.get('year')) !== null) return true;
  const locale: string | null = route.root.firstChild?.paramMap.get('locale') ?? null;
  if (locale === null) throw new Error('tax-return route without a locale');
  return inject(Router).createUrlTree(['/', locale, 'tax-return']);
};
