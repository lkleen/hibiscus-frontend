import type { TranslationService } from '../services/translation.service';

/**
 * The ag-Grid `localeText` keys the tables use that the grid would otherwise show in English: the
 * filter menus and the pagination panel. Each one has a `grid.<key>` entry in the dictionaries
 * (a missing entry is a compile error).
 */
const GRID_LOCALE_KEYS = [
  'page',
  'of',
  'to',
  'pageSizeSelectorLabel',
  'firstPage',
  'previousPage',
  'nextPage',
  'lastPage',
  'filterOoo',
  'equals',
  'notEqual',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'blank',
  'notBlank',
  'lessThan',
  'greaterThan',
  'lessThanOrEqual',
  'greaterThanOrEqual',
  'inRange',
  'inRangeStart',
  'inRangeEnd',
  'andCondition',
  'orCondition',
  'applyFilter',
  'resetFilter',
  'clearFilter',
  'dateFormatOoo',
] as const;

/** ag-Grid's `localeText` in the active locale; read it inside a `computed` to follow a switch. */
export function gridLocaleText(i18n: TranslationService): Record<string, string> {
  const text: Record<string, string> = {};
  for (const key of GRID_LOCALE_KEYS) {
    text[key] = i18n.t(`grid.${key}`);
  }
  return text;
}
