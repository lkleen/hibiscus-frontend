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
  /** Mirrors ag-Grid's ColDef `resizable`. Default `true`; irrelevant when `options.columnResize`
   *  is `false` (no column gets a handle then). `false` sets PrimeNG's `pResizableColumnDisabled`
   *  on this header cell, so no drag handle is created for it; the other columns stay resizable.
   *  PrimeNG creates the handle once, after the view initialises, so changing this at runtime has
   *  no effect. */
  readonly resizable?: boolean;
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
 * A per-column width limit for the `fitGridWidth` `autoSizeStrategy`, mirroring ag-Grid's
 * `columnLimits` (this project doesn't support ag-Grid's `width`/`flex`; see the "column sizing"
 * plan). There is deliberately no `maxWidth`. Chrome ignores `max-width` on table cells under auto
 * layout, and even a capped inner wrapper can't hold a column down, because a `width: 100%` table
 * hands its spare width to columns in proportion to their content (verified in the browser). A
 * real cap would need `table-layout: fixed`, which turns off content sizing altogether.
 *
 * `minWidth` is a **px number, not a CSS string**: it ends up as the header `th`'s inline
 * `min-width`, which Chrome does honour, and PrimeNG's own column-resize code
 * (`onColumnResizeEnd` in `primeng-table.mjs`) reads that inline `min-width` back with
 * `replace(/[^\d.]/g, '')` and treats the digits as px — a CSS string like `'8rem'` would silently
 * become an 8px floor the moment a user drags that column. Speaking px from the start avoids that
 * trap. (`DataTableOptions.minWidth`, the *table's* width floor, stays a CSS string on purpose —
 * PrimeNG's resize code never reads it, so it isn't subject to this parsing.)
 */
export interface DataTableColumnLimit {
  readonly colId: string;
  readonly minWidth: number; // px
}

/**
 * Mirrors ag-Grid's grid-level `autoSizeStrategy` (`GridOptions.autoSizeStrategy.type`:
 * `'fitGridWidth' | 'fitProvidedWidth' | 'fitCellContents'`). Unlike ag-Grid, this is done in pure
 * CSS, not by measuring cells in JS — see `data-table.component.ts`'s `tableStyle`/`headerMinWidth`
 * for how each variant maps onto the `<table>` and its header cells:
 * - `'fitGridWidth'` — the table fills its container (PrimeNG's own default `width: 100%`); columns
 *   without their own `columnLimits` entry fall back to `defaultMinWidth`.
 * - `'fitProvidedWidth'` — the table is fixed at `width` (px).
 * - `'fitCellContents'` — the table sizes to `width: max-content` and every cell gets
 *   `white-space: nowrap` (the `data-table--fit-contents` modifier class), so columns take exactly
 *   their content's width, the same visual effect ag-Grid's `autoSizeAllColumns()` produces.
 */
export type DataTableAutoSizeStrategy =
  | {
      readonly type: 'fitGridWidth';
      /** px, applied to every visible column that has no `columnLimits` entry of its own. */
      readonly defaultMinWidth?: number;
      readonly columnLimits?: readonly DataTableColumnLimit[];
    }
  | { readonly type: 'fitProvidedWidth'; readonly width: number } // px
  | { readonly type: 'fitCellContents' };

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
  /** `false` disables the table's own scroll container (no `scrollable`/`scrollHeight`).
   *  `'flex'` makes the table fill its parent instead of a fixed height; the parent must then be a
   *  flex column with a bounded height (see `data-table.component.scss`). */
  readonly scrollHeight?: string | false;
  /** `undefined` sets no `min-width` on the table (natural sizing) — deliberately not defaulted;
   *  see `data-table.defaults.ts`. Combines with `autoSizeStrategy` — it's a floor on top of
   *  whatever width the strategy computes, not an alternative to it. */
  readonly minWidth?: string;
  /** ag-Grid's grid-level `autoSizeStrategy`. Default: `{ type: 'fitGridWidth' }` (see
   *  `DEFAULT_TABLE_OPTIONS`). */
  readonly autoSizeStrategy?: DataTableAutoSizeStrategy;
  /** ag-Grid's column resizing, expressed with PrimeNG's own resize knobs: `false` disables dragging
   *  entirely (every header cell gets `pResizableColumnDisabled`, because PrimeNG creates a handle
   *  whenever that is not `true`, whatever the table's `resizableColumns` says); `{ mode }` maps 1:1 to PrimeNG's
   *  `columnResizeMode` (`'fit'` takes width from the next column, `'expand'` grows the table and
   *  scrolls horizontally — ag-Grid's own default). Per-column opt-out is `DataTableColDefBase`'s
   *  `resizable`. Default: `{ mode: 'expand' }` (see `DEFAULT_TABLE_OPTIONS`). */
  readonly columnResize?: false | { readonly mode: 'fit' | 'expand' };
  /** Drag-and-drop column reordering by header, mirroring ag-Grid's `suppressMovableColumns`
   *  inverted to match the positive naming of `columnResize`/`striped`. Maps to PrimeNG's
   *  `[reorderableColumns]` plus a static `pReorderableColumn` on every header cell (see
   *  `data-table.component.html`). The order itself is session state only — kept in
   *  `DataTableComponent.visibleColumns` while the component lives, reset whenever `columns()`
   *  itself changes (a new array reference) or the table is recreated; there is no localStorage.
   *  No per-column opt-out (YAGNI; add ag-Grid's `suppressMovable` if a table ever needs one).
   *  Default `true`. */
  readonly columnReorder?: boolean;
  /** Required, not defaulted: there is no honest generic "no rows" copy for an arbitrary table
   *  (see `DEFAULT_TABLE_OPTIONS`'s comment in `data-table.defaults.ts`). Making this required
   *  rather than optional-with-a-runtime-throw means a caller that forgets it gets a compile
   *  error, not a message that only surfaces once the table happens to render empty. */
  readonly emptyKey: TranslationKey;
  /** Like ag-Grid's `getRowId`: the row's stable business identity, used for `rowTrackBy`. Always
   *  called with the *raw* row. */
  readonly getRowId: (row: Row) => string | number;
}
