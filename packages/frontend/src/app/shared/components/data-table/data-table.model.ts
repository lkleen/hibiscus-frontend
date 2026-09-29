import type { TranslationKey } from '../../../core/models/translation.model';

/** The built-in `p-columnFilter` kinds this component wires up. */
export type DataTableFilterType = 'text' | 'numeric' | 'date';

/**
 * A column definition, modelled on ag-Grid's `ColDef`: rows stay raw data, and every computed
 * value (what's shown, how it sorts, how it's searched/filtered) belongs to the column as a
 * lambda evaluated live against the raw row — never materialised onto the row.
 *
 * `Value` is the type `valueGetter` produces and every other lambda on this column consumes. It
 * defaults to `unknown` so a *heterogeneous* array of columns — `DataTableColDef<Row>[]`, i.e.
 * `DataTableColDef<Row, unknown>[]`, exactly what `columns` on `<app-data-table>` expects — can
 * hold columns whose individual `Value`s differ (a `string` column next to a `number` column).
 *
 * Authoring a single column with a concrete `Value` (so `valueGetter`'s return type flows into
 * `valueFormatter`/`comparator`/`getQuickFilterText` without a cast) and then widening it into
 * that array is exactly what the `colDef()` helper below does — see its own comment for why the
 * widening needs a helper instead of being a plain assignment.
 */
interface DataTableColDefBase<Row, Value> {
  /** Unique across the table's columns. Also the key the column-accessor proxy answers filters
   *  for — see `column-accessor-proxy.ts`. */
  readonly colId: string;
  /** Default: `row[colId]` (see `defaultValueGetter` in `data-table.defaults.ts`). */
  readonly valueGetter?: (row: Row) => Value;
  /** Default: `dashFormatter` — renders a dash for a null/undefined/blank value, `String(value)`
   *  otherwise. */
  readonly valueFormatter?: (value: Value, row: Row) => string;
  /** Name of an `appDataTableCell` template registered by the caller (see
   *  `data-table-cell.directive.ts`); overrides `valueFormatter` for the cell's markup. Throws if
   *  no such template is registered. */
  readonly cellRenderer?: string;
  /** Default `true`. */
  readonly sortable?: boolean;
  /** Returns the **ascending** result: negative when `a` sorts before `b`, positive when it sorts
   *  after, `0` when equal — an ordinary `Array.prototype.sort` comparator, exactly like ag-Grid's
   *  own `comparator`. The component applies the requested direction itself (multiplying by the
   *  column's sort order), so a comparator never needs to special-case descending.
   *  `isDescending` exists only so a comparator can pin direction-invariant values (e.g. empties
   *  always last) — see `defaultComparator`, which is the one comparator that actually reads it.
   *  A comparator that doesn't care about empty placement can ignore the third parameter entirely.
   *  Default: `defaultComparator`. */
  readonly comparator?: (a: Value, b: Value, isDescending: boolean) => number;
  /** `false` renders no filter cell for the column. Default `'text'`. */
  readonly filter?: DataTableFilterType | false;
  /** What the column-accessor proxy answers for this `colId`. Default: per filter type — `'date'`
   *  parses the value with `parseIsoDate`, everything else passes `valueGetter`'s result through
   *  unchanged (see `defaultFilterValueGetter`). */
  readonly filterValueGetter?: (row: Row) => unknown;
  /** What the global (quick) filter searches for this column. Default: the raw `valueGetter`
   *  result, unformatted. */
  readonly getQuickFilterText?: (value: Value, row: Row) => unknown;
  readonly align?: 'start' | 'end';
}

/** A rendered column: shows a header/filter/body cell and is included in the quick filter. */
export interface DataTableVisibleColDef<Row, Value = unknown> extends DataTableColDefBase<
  Row,
  Value
> {
  readonly hide?: false;
  readonly headerKey: TranslationKey;
}

/** ag-Grid's `hide`: no header/filter/body cell and excluded from the quick filter, but still
 *  participates in `defaultSort`/sorting — e.g. a hidden id column used only as a sort tie-break.
 *  Has no `headerKey`: nothing ever renders it, so there is nothing to translate. */
export interface DataTableHiddenColDef<Row, Value = unknown> extends DataTableColDefBase<
  Row,
  Value
> {
  readonly hide: true;
}

export type DataTableColDef<Row, Value = unknown> =
  DataTableVisibleColDef<Row, Value> | DataTableHiddenColDef<Row, Value>;

/** Narrows a column to the visible variant (`hide` not `true`), so `headerKey` is known to exist
 *  without a cast. Used to type `DataTableComponent.visibleColumns` — the header row, and every
 *  other rendered-columns-only code path, iterates that rather than `columns()` directly. */
export function isVisibleColumn<Row, Value>(
  column: DataTableColDef<Row, Value>,
): column is DataTableVisibleColDef<Row, Value> {
  return column.hide !== true;
}

/**
 * Widens a strongly-typed column definition to the array element type a heterogeneous `columns`
 * array needs (`DataTableColDef<Row, unknown>`, i.e. plain `DataTableColDef<Row>`).
 *
 * Without this helper, authoring `{ colId: 'betrag', valueGetter: (r) => r.betrag, valueFormatter:
 * (v: number, r) => … }` directly inside a `DataTableColDef<Row>[]` array literal fails to
 * typecheck: TypeScript's `strictFunctionTypes` checks a property-declared function type's
 * parameters *contravariantly*, so `(value: number, row: Row) => string` is not assignable to the
 * array element's `(value: unknown, row: Row) => string` (that would require `unknown` to be
 * assignable to `number`, which it isn't). This is the same variance issue ag-Grid's own
 * `ColDef<TData, TValue>` has — ag-Grid works around it by typing its column arrays `any`, which
 * this project's "no `any`" rule forbids.
 *
 * `colDef()` lets a column be authored with its own concrete `Value` (full type safety *within*
 * that one column: `valueGetter`'s return type flows into `valueFormatter`/`comparator`/
 * `getQuickFilterText`), then widens it with a single, explicit, documented cast. This is safe in
 * practice even though it isn't safe in the general case TypeScript is protecting against: the
 * data-table component only ever calls a column's lambdas with values that the *same* column's
 * own `valueGetter` produced, never with an unrelated `unknown`. Call sites need no cast of their
 * own — only this one place asserts the fact.
 *
 * `DataTableColDef` is itself a union (`DataTableVisibleColDef | DataTableHiddenColDef`, see
 * `isVisibleColumn`); `colDef()` widens whichever variant it's given and passes the `hide`
 * discriminant through untouched — a hidden column stays hidden, a visible one keeps its
 * `headerKey`.
 */
export function colDef<Row, Value>(
  def: DataTableColDef<Row, Value>,
): DataTableColDef<Row, unknown> {
  return def as unknown as DataTableColDef<Row, unknown>;
}

export interface DataTableSortModel {
  readonly colId: string;
  readonly order: 1 | -1;
}

/**
 * Grid-level options, modelled on ag-Grid's `GridOptions`. Every key is optional except
 * `getRowId` and `emptyKey`; the rest default from `DEFAULT_TABLE_OPTIONS` in
 * `data-table.defaults.ts` — see that file's comment for `minWidth`, the one optional key
 * deliberately *not* defaulted there, because no generic width would be honest for every table.
 */
export interface DataTableOptions<Row> {
  readonly pagination?:
    false | { readonly pageSize: number; readonly pageSizes: readonly number[] };
  readonly quickFilter?: false | { readonly matcher?: (text: string, query: string) => boolean };
  /** Initial `multiSortMeta`. May reference a `hide: true` column (a sort-only tie-break). */
  readonly defaultSort?: readonly DataTableSortModel[];
  readonly striped?: boolean;
  /** `false` disables the table's own scroll container (no `scrollable`/`scrollHeight`). */
  readonly scrollHeight?: string | false;
  /** `undefined` sets no `min-width` on the table (natural sizing) — deliberately not defaulted;
   *  see `data-table.defaults.ts`. */
  readonly minWidth?: string;
  /** Required, not defaulted: there is no honest generic "no rows" copy for an arbitrary table
   *  (see `DEFAULT_TABLE_OPTIONS`'s comment in `data-table.defaults.ts`). Making this required
   *  rather than optional-with-a-runtime-throw means a caller that forgets it gets a compile
   *  error, not a message that only surfaces once the table happens to render empty. */
  readonly emptyKey: TranslationKey;
  /** Like ag-Grid's `getRowId`: the row's stable business identity, used for `rowTrackBy`. Always
   *  called with the *raw* row. */
  readonly getRowId: (row: Row) => string | number;
}
