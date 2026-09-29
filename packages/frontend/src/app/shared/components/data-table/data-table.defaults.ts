import type { DataTableFilterType, DataTableOptions } from './data-table.model';

/** Default `valueGetter`: the raw row's own `colId` field, unresolved and untouched. */
export function defaultValueGetter<Row>(colId: string): (row: Row) => unknown {
  return (row: Row): unknown => (row as Record<string, unknown>)[colId];
}

/**
 * Default `valueFormatter`. Empty text cells show a dash — a null/undefined value, or a
 * whitespace-only string, otherwise `String(value)`. This is the app-wide "empty cell" contract
 * (matches the other tables in the app), not something specific to any one column.
 */
export function dashFormatter(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && value.trim() === '') return '—';
  return String(value);
}

/**
 * Default `comparator`. Returns the **ascending** result — the component itself multiplies this
 * by the column's sort order (`compareRows` in `data-table.component.ts`), so this function never
 * looks at "am I sorting ascending or descending" for a normal compare. The one place direction
 * still matters is empty placement, which is where `isDescending` comes in:
 * - `a`/`b` empty (`null`/`undefined`/`''`/an empty array/a plain `{}`) sorts **after** every
 *   non-empty value, in *both* ascending and descending order. Since the component negates this
 *   function's result for a descending sort, returning a *fixed* sign for "a is empty" would flip
 *   which side the empty value lands on between the two directions — so this function returns
 *   `isDescending ? -1 : 1` for "a empty, b not" (and the mirror, `isDescending ? 1 : -1`, for "b
 *   empty, a not"), which the component's later negation turns back into "always last" both ways;
 * - two strings compare with `localeCompare(b, undefined, { numeric: true })` (so `'a2' < 'a10'`);
 * - everything else compares with `<`/`>`.
 *
 * This is behaviour-parity with PrimeNG 21's own multi-sort compare
 * (`ObjectUtils.sort(v1, v2, order, undefined, 1)` composed with `ObjectUtils.compare`'s
 * `isEmpty` check — read from `primeng-utils.mjs`, not re-derived from memory): the net sort order
 * this produces, once the component applies direction, is identical to PrimeNG's own.
 */
export function defaultComparator<Value>(a: Value, b: Value, isDescending: boolean): number {
  const emptyA = isEmpty(a);
  const emptyB = isEmpty(b);
  if (emptyA && emptyB) return 0;
  if (emptyA) return isDescending ? -1 : 1;
  if (emptyB) return isDescending ? 1 : -1;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b, undefined, { numeric: true });
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (!(value instanceof Date) && typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Parses a `YYYY-MM-DD` string as a *local* midnight `Date`, matching what PrimeNG's date-filter
 * datepicker produces for the same calendar day. A plain `new Date(isoString)` parses a date-only
 * ISO string as UTC, which shifts a day in negative-offset timezones. `null` if the value doesn't
 * parse — this only feeds column filters, never display or sort.
 *
 * Moved here from the transactions feature (`transactions.component.ts`), which is being migrated
 * onto this component; the copy there is removed by that migration, not by this change.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * Default `filterValueGetter`, applied to `valueGetter`'s result. Every filter type except
 * `'date'` passes the value through unchanged — for `'date'`, PrimeNG's date filter renders a
 * datepicker and emits a `Date`, then compares with `.toDateString()`/`.getTime()`, which throws
 * on a plain ISO string, so the value must become a `Date` first.
 */
export function defaultFilterValueGetter(filterType: DataTableFilterType, value: unknown): unknown {
  if (filterType === 'date') {
    return typeof value === 'string' ? parseIsoDate(value) : null;
  }
  return value;
}

/**
 * Strips accents/diacritics the same way PrimeNG's own `ObjectUtils.removeAccents` does
 * (`primeng-utils.mjs`): Unicode-normalise to NFKD (splits a base letter from its combining
 * accent marks) and drop every combining-diacritical-mark character.
 */
function removeAccents(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '');
}

/**
 * A case-insensitive, accent-insensitive substring match — the same rule PrimeNG's own
 * `'contains'` match mode applies (`FilterService.filters.contains` in `primeng-api.mjs`:
 * `removeAccents` + `toLocaleLowerCase` on both sides, then a substring check). Exported so a
 * custom `quickFilter.matcher` can compose with it (e.g. "contains, but also match this extra
 * computed field") instead of re-implementing it.
 */
export function containsMatcher(text: string, query: string): boolean {
  if (query.trim() === '') return true;
  const filterValue = removeAccents(query).toLocaleLowerCase();
  const stringValue = removeAccents(text).toLocaleLowerCase();
  return stringValue.includes(filterValue);
}

/**
 * Defaults for `DataTableOptions`'s optional keys. `minWidth` is deliberately absent: there is no
 * honest generic table width, so omitting it means no `min-width` style is set at all (natural
 * sizing) unless a feature supplies one — same as any other CSS default. `emptyKey` isn't part of
 * this object at all, and never will be: it's `required` on `DataTableOptions`, not
 * optional-with-a-default, because there is no honest generic "no rows" copy either — see that
 * field's own comment in `data-table.model.ts`.
 */
export const DEFAULT_TABLE_OPTIONS: {
  readonly pagination: { readonly pageSize: number; readonly pageSizes: readonly number[] };
  readonly quickFilter: NonNullable<DataTableOptions<never>['quickFilter']>;
  readonly striped: boolean;
  readonly scrollHeight: string | false;
} = {
  pagination: { pageSize: 20, pageSizes: [10, 20, 50, 100] },
  quickFilter: {},
  striped: true,
  scrollHeight: '36rem',
};
