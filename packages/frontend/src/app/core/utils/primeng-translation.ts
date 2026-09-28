import type { Translation } from 'primeng/api';
import type { TranslationService } from '../services/translation.service';

/**
 * The PrimeNG `Translation` keys (see `primeng/types/primeng-api.d.ts`) the transactions table's
 * filter menus read that PrimeNG would otherwise show in English. Each one has a `primeng.<key>`
 * entry in the dictionaries (a missing entry is a compile error).
 */
const PRIMENG_TRANSLATION_KEYS = [
  'startsWith',
  'contains',
  'notContains',
  'endsWith',
  'equals',
  'notEquals',
  'lt',
  'lte',
  'gt',
  'gte',
  'dateIs',
  'dateIsNot',
  'dateBefore',
  'dateAfter',
  'noFilter',
  'clear',
  'apply',
  'matchAll',
  'matchAny',
  'addRule',
  'removeRule',
] as const;

/** The `Translation.aria` keys the table and paginator actually read; same compile-error guard. */
const PRIMENG_ARIA_KEYS = [
  'firstPageLabel',
  'lastPageLabel',
  'nextPageLabel',
  'prevPageLabel',
  'rowsPerPageLabel',
  'selectRow',
  'unselectRow',
  'showFilterMenu',
  'hideFilterMenu',
  'filterOperator',
  'filterConstraint',
] as const;

/**
 * PrimeNG's `Translation` in the active locale, for `PrimeNG.setTranslation()`; read inside an
 * `effect` to follow a locale switch.
 *
 * `aria.pageLabel` is handled separately from the loop below: PrimeNG's own paginator substitutes
 * a literal `{page}` token in that string with the current page number itself (see
 * `primeng-paginator.mjs`, `pageLabel?.replace(/{page}/g, value)`), so the dictionary entry is
 * just `"{page}"` in both locales. Passing `{ page: '{page}' }` satisfies `TranslationService.t()`'s
 * own placeholder check — which would otherwise throw on an unfilled `{page}` — without changing
 * the token, which must survive intact for PrimeNG to replace later.
 */
export function primengTranslation(i18n: TranslationService): Translation {
  const translation: Record<string, string> = {};
  for (const key of PRIMENG_TRANSLATION_KEYS) {
    translation[key] = i18n.t(`primeng.${key}`);
  }

  const aria: Record<string, string> = {
    pageLabel: i18n.t('primeng.aria.pageLabel', { page: '{page}' }),
  };
  for (const key of PRIMENG_ARIA_KEYS) {
    aria[key] = i18n.t(`primeng.aria.${key}`);
  }

  return { ...translation, aria } as Translation;
}
