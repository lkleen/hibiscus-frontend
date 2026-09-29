import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  TemplateRef,
  computed,
  contentChildren,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FilterMatchMode, FilterService } from 'primeng/api';
import { Table, TableModule } from 'primeng/table';
import type { TranslationKey } from '../../../core/models/translation.model';
import { TranslationService } from '../../../core/services/translation.service';
import { getRawRow, createColumnAccessorProxyFactory } from './column-accessor-proxy';
import { DataTableCellDirective, type DataTableCellContext } from './data-table-cell.directive';
import {
  DEFAULT_TABLE_OPTIONS,
  dashFormatter,
  defaultComparator,
  defaultValueGetter,
} from './data-table.defaults';
import { isVisibleColumn } from './data-table.model';
import type {
  DataTableAutoSizeStrategy,
  DataTableColDef,
  DataTableFilterType,
  DataTableOptions,
  DataTableVisibleColDef,
} from './data-table.model';

/** The `matchMode` name a caller-supplied `quickFilter.matcher` is registered under on this
 *  component's own `FilterService` instance — never on the app-wide `providedIn: 'root'` one. */
const QUICK_FILTER_MATCH_MODE = 'dataTableQuickFilter';

/**
 * Shape of `p-table`'s `(sortFunction)` payload. PrimeNG types this `EventEmitter<any>` (see
 * `types/primeng-table.d.ts`), so this interface — not `any` — is what this component's own
 * handler is typed against; the untyped boundary is PrimeNG's, not introduced here.
 */
interface DataTableSortFunctionEvent<Row> {
  readonly data: Row[];
  readonly mode: 'single' | 'multiple';
  readonly field?: string;
  readonly order?: 1 | -1;
  readonly multiSortMeta?: readonly { readonly field: string; readonly order: 1 | -1 }[];
}

/** A sort key resolved to this component's own vocabulary (`colId`, not PrimeNG's `field`). */
interface ResolvedSortKey {
  readonly colId: string;
  readonly order: 1 | -1;
}

/**
 * The project's one generic table component — every flat table goes through this, never
 * `<p-table>` directly (see `CLAUDE.md` and the `angular-primeng-table` skill). Modelled on
 * ag-Grid's `ColDef`/`GridOptions`/grid API: rows stay raw, every computed value is a column
 * lambda evaluated live (see `data-table.model.ts`), and every feature is switchable off with a
 * replaceable default lambda (see `data-table.defaults.ts`).
 *
 * `sortMode="multiple"` and `customSort` are fixed, not configurable — the whole point of this
 * component is that sorting always goes through column `comparator`s (`onSortFunction` below), so
 * there is no supported "let PrimeNG sort raw values" mode to switch to.
 */
@Component({
  selector: 'app-data-table',
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TableModule, NgTemplateOutlet],
  providers: [FilterService],
  host: { '[class.data-table-host--fill]': "scrollHeight() === 'flex'" },
})
export class DataTableComponent<Row extends object> {
  protected readonly i18n = inject(TranslationService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly filterService = inject(FilterService);

  readonly value = input.required<readonly Row[]>();
  readonly columns = input.required<readonly DataTableColDef<Row, unknown>[]>();
  readonly options = input.required<DataTableOptions<Row>>();
  readonly loading = input<boolean>(false);

  private readonly cellTemplates = contentChildren(DataTableCellDirective<Row>);
  private readonly table = viewChild<Table<Row>>('dt');

  protected readonly q = signal('');

  private readonly proxyFactory = createColumnAccessorProxyFactory<Row>(() => this.columns());

  /** New only when `value()` itself changes; proxies are reused from the factory's `WeakMap`, so
   *  their identity — and therefore PrimeNG's `filteredValue`/paging — stays stable across an
   *  in-place mutation of a raw row followed by `refresh()`. */
  protected readonly boundRows = computed<Row[]>(() =>
    this.value().map((row) => this.proxyFactory.getProxy(row)),
  );

  // `isVisibleColumn` is a type guard (`data-table.model.ts`), so this narrows to
  // `DataTableVisibleColDef` — every rendered-columns-only code path (the header row, this array's
  // consumers below) gets `headerKey` known to exist, with no cast.
  protected readonly visibleColumns = computed<readonly DataTableVisibleColDef<Row, unknown>[]>(
    () => this.columns().filter(isVisibleColumn),
  );

  protected readonly emptyColspan = computed<number>(() => this.visibleColumns().length);

  protected readonly quickFilterEnabled = computed<boolean>(
    () => this.options().quickFilter !== false,
  );

  protected readonly quickFilterMatchMode = computed<string>(() => {
    const quickFilter = this.options().quickFilter;
    // `&&`, not `!== false &&`: `quickFilter` is `false | {...} | undefined`, and `!== false`
    // alone still leaves `undefined` in the narrowed type (`undefined !== false` is true), so
    // `.matcher` would still be a possibly-undefined access. A plain truthiness check excludes
    // both falsy variants (`false` and `undefined`) in one step.
    return quickFilter && quickFilter.matcher ? QUICK_FILTER_MATCH_MODE : FilterMatchMode.CONTAINS;
  });

  /** One function per non-hidden column, `(proxy) => getQuickFilterText(valueGetter(raw), raw)`.
   *  PrimeNG's `globalFilterFields` entries are called with the *bound* row (a proxy here) when
   *  they're functions (`ObjectUtils.resolveFieldData`) — verified in `primeng-utils.mjs`. */
  protected readonly globalFilterFields = computed<readonly ((row: Row) => unknown)[]>(() =>
    this.visibleColumns().map((column) => {
      const valueGetter = column.valueGetter ?? defaultValueGetter<Row>(column.colId);
      const getQuickFilterText = column.getQuickFilterText ?? ((value: unknown) => value);
      return (row: Row): unknown => {
        const raw = getRawRow(row);
        return getQuickFilterText(valueGetter(raw), raw);
      };
    }),
  );

  // The one typed boundary between `globalFilterFields` above and `<p-table>`'s own
  // `[globalFilterFields]` input. PrimeNG 21's own `.d.ts` (`types/primeng-table.d.ts`) types that
  // input `string[] | undefined`, but its runtime — `Table._filter()` calling
  // `ObjectUtils.resolveFieldData(this.value[i], globalFilterField)` (`primeng-table.mjs`) — calls
  // an entry as a function when `ObjectUtils.isFunction` says it is (`primeng-utils.mjs`), rather
  // than reading it as a field name. The functions above rely on exactly that verified behaviour,
  // so this single, documented `as unknown as string[]` bridges the declared-type/actual-behaviour
  // gap where the template binds to PrimeNG; it is not a claim that the values really are strings.
  protected readonly globalFilterFieldsForPrimeNg = computed<string[]>(
    () => this.globalFilterFields() as unknown as string[],
  );

  protected readonly paginationEnabled = computed<boolean>(
    () => this.options().pagination !== false,
  );

  protected readonly pageSize = computed<number>(() => {
    const pagination = this.options().pagination;
    return pagination === false || !pagination
      ? DEFAULT_TABLE_OPTIONS.pagination.pageSize
      : pagination.pageSize;
  });

  // A fresh mutable copy, not the `readonly number[]` `DataTableOptions`/`DEFAULT_TABLE_OPTIONS`
  // declare: PrimeNG's own `rowsPerPageOptions` input is typed `any[] | undefined` — a mutable
  // array type a `readonly` one is never assignable to, regardless of element type.
  protected readonly rowsPerPageOptions = computed<number[]>(() => {
    const pagination = this.options().pagination;
    return pagination === false || !pagination
      ? [...DEFAULT_TABLE_OPTIONS.pagination.pageSizes]
      : [...pagination.pageSizes];
  });

  protected readonly striped = computed<boolean>(
    () => this.options().striped ?? DEFAULT_TABLE_OPTIONS.striped,
  );

  private readonly scrollHeightOption = computed<string | false>(
    () => this.options().scrollHeight ?? DEFAULT_TABLE_OPTIONS.scrollHeight,
  );
  protected readonly scrollable = computed<boolean>(() => this.scrollHeightOption() !== false);
  protected readonly scrollHeight = computed<string | undefined>(() => {
    const height = this.scrollHeightOption();
    return height === false ? undefined : height;
  });

  protected readonly autoSizeStrategy = computed<DataTableAutoSizeStrategy>(
    () => this.options().autoSizeStrategy ?? DEFAULT_TABLE_OPTIONS.autoSizeStrategy,
  );

  /** `fitCellContents`'s CSS modifier class — see `data-table.component.scss`. */
  protected readonly fitContents = computed<boolean>(
    () => this.autoSizeStrategy().type === 'fitCellContents',
  );

  private readonly columnResizeOption = computed<false | { readonly mode: 'fit' | 'expand' }>(
    () => this.options().columnResize ?? DEFAULT_TABLE_OPTIONS.columnResize,
  );

  protected readonly resizeEnabled = computed<boolean>(() => this.columnResizeOption() !== false);

  // `<p-table>`'s `[columnResizeMode]` still needs a value when resize is disabled (PrimeNG just
  // never reads it then, since `resizableColumns` is `false`) — `'expand'` is as good a filler as
  // any, so this never has to special-case "disabled" beyond `resizeEnabled` above.
  protected readonly resizeMode = computed<'fit' | 'expand'>(() => {
    const option = this.columnResizeOption();
    return option === false ? 'expand' : option.mode;
  });

  /** `colId` → this column's `fitGridWidth` min width (px), built from `autoSizeStrategy`'s
   *  `columnLimits`. Throws on a `colId` that isn't a visible column — the same fail-loud contract
   *  `columnById` already applies to sort meta, extended here to width limits. Empty for every
   *  strategy but `fitGridWidth`. */
  private readonly columnMinWidths = computed<ReadonlyMap<string, number>>(() => {
    const strategy = this.autoSizeStrategy();
    if (strategy.type !== 'fitGridWidth') return new Map<string, number>();
    const visibleColIds: ReadonlySet<string> = new Set(
      this.visibleColumns().map((column) => column.colId),
    );
    const minWidths = new Map<string, number>();
    for (const limit of strategy.columnLimits ?? []) {
      if (!visibleColIds.has(limit.colId)) {
        throw new Error(
          `data-table: unknown column "${limit.colId}" in autoSizeStrategy.columnLimits`,
        );
      }
      minWidths.set(limit.colId, limit.minWidth);
    }
    return minWidths;
  });

  // `tableStyle` merges `options.minWidth` (a floor, every strategy) with the strategy's own table
  // width (see `DataTableAutoSizeStrategy`'s doc comment for what each variant maps to). This is a
  // `computed`, so its identity is stable across unrelated change detection runs — important for
  // `'expand'`-mode resize, which writes `style.width`/`style.minWidth` on the `<table>` directly:
  // `[tableStyle]` re-diffs by value each cycle, and an unchanged object produces no updates, so a
  // dragged width survives paging/sorting/filtering instead of being overwritten every cycle.
  protected readonly tableStyle = computed<Record<string, string> | undefined>(() => {
    const minWidth = this.options().minWidth;
    const strategy = this.autoSizeStrategy();
    const width =
      strategy.type === 'fitProvidedWidth'
        ? `${strategy.width}px`
        : strategy.type === 'fitCellContents'
          ? 'max-content'
          : undefined;
    if (!minWidth && !width) return undefined;
    return {
      ...(minWidth ? { 'min-width': minWidth } : {}),
      ...(width ? { width } : {}),
    };
  });

  protected readonly multiSortMeta = computed<{ field: string; order: 1 | -1 }[]>(() =>
    (this.options().defaultSort ?? []).map((sort) => ({ field: sort.colId, order: sort.order })),
  );

  // `TranslationService.t()` throws on any `{word}` left in the template that isn't in `params`.
  // The literal `{first}`/`{last}`/`{totalRecords}` tokens must survive substitution unchanged —
  // PrimeNG's own paginator replaces them later — so passing each back as its own token satisfies
  // `t()`'s placeholder check without touching the token.
  protected readonly pageReportTemplate = computed<string>(() =>
    this.i18n.t('table.pageReport', {
      first: '{first}',
      last: '{last}',
      totalRecords: '{totalRecords}',
    }),
  );

  // `emptyKey` is `required` on `DataTableOptions` (see its comment in `data-table.model.ts`), so
  // there is nothing to default or guard here — the type system is the fail-loud mechanism.
  protected readonly emptyKey = computed<TranslationKey>(() => this.options().emptyKey);

  protected readonly rowTrackBy = (_index: number, row: Row): string | number =>
    this.options().getRowId(getRawRow(row));

  private readonly cellTemplatesByRenderer = computed<
    ReadonlyMap<string, TemplateRef<DataTableCellContext<Row>>>
  >(
    () =>
      new Map(
        this.cellTemplates().map((directive) => [
          directive.appDataTableCell(),
          directive.templateRef,
        ]),
      ),
  );

  constructor() {
    // Registered once; reads the *current* options on every call, so a `quickFilter.matcher`
    // change is picked up without re-registering. Only ever selected as the active matchMode when
    // `quickFilterMatchMode()` returns this name (i.e. a matcher is actually configured) — see the
    // thrown error below, which should therefore be unreachable.
    this.filterService.register(
      QUICK_FILTER_MATCH_MODE,
      (value: unknown, filter: unknown): boolean => {
        const quickFilter = this.options().quickFilter;
        // See the narrowing note on `quickFilterMatchMode` above — `!quickFilter` excludes both
        // `false` and `undefined` in one step, where `quickFilter === false` alone would not.
        if (!quickFilter || !quickFilter.matcher) {
          throw new Error(
            'data-table: quick-filter match mode invoked without a configured matcher',
          );
        }
        return quickFilter.matcher(String(value ?? ''), String(filter ?? ''));
      },
    );
  }

  protected filterType(column: DataTableColDef<Row, unknown>): DataTableFilterType {
    return column.filter === false ? 'text' : (column.filter ?? 'text');
  }

  /** The header `th`'s inline `min-width` (px) for `fitGridWidth`: the column's own
   *  `columnLimits` entry, else the strategy's `defaultMinWidth`, else unset — `undefined` clears
   *  the `[style.min-width.px]` binding rather than writing `0`. Every other strategy leaves
   *  columns unset (`fitProvidedWidth`: natural; `fitCellContents`: the `nowrap` modifier class
   *  does the sizing). */
  protected headerMinWidth(column: DataTableVisibleColDef<Row, unknown>): number | undefined {
    const strategy = this.autoSizeStrategy();
    if (strategy.type !== 'fitGridWidth') return undefined;
    return this.columnMinWidths().get(column.colId) ?? strategy.defaultMinWidth;
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.q.set(value);
    this.table()?.filterGlobal(value, this.quickFilterMatchMode());
  }

  /** ag-Grid-style `refreshCells()`: repaints without rebuilding anything. A feature that mutates
   *  a raw row in place (e.g. a category change) only needs this — values are computed live, so
   *  there is nothing to recompute ahead of time. */
  refresh(): void {
    this.cdr.markForCheck();
  }

  protected cellView(
    column: DataTableColDef<Row, unknown>,
    row: Row,
  ): { readonly raw: Row; readonly value: unknown; readonly formatted: string } {
    const raw = getRawRow(row);
    const valueGetter = column.valueGetter ?? defaultValueGetter<Row>(column.colId);
    const value = valueGetter(raw);
    const formatter = column.valueFormatter ?? dashFormatter;
    return { raw, value, formatted: formatter(value, raw) };
  }

  protected templateFor(rendererName: string): TemplateRef<DataTableCellContext<Row>> {
    const template = this.cellTemplatesByRenderer().get(rendererName);
    if (!template) {
      throw new Error(`data-table: no cell template registered for cellRenderer "${rendererName}"`);
    }
    return template;
  }

  protected onSortFunction(event: DataTableSortFunctionEvent<Row>): void {
    const sortMeta = this.resolveSortMeta(event);
    event.data.sort((a, b) => this.compareRows(a, b, sortMeta));
  }

  private resolveSortMeta(event: DataTableSortFunctionEvent<Row>): readonly ResolvedSortKey[] {
    if (event.multiSortMeta) {
      return event.multiSortMeta.map((meta) => ({ colId: meta.field, order: meta.order }));
    }
    if (event.field && event.order) {
      return [{ colId: event.field, order: event.order }];
    }
    throw new Error('data-table: sortFunction event has neither field nor multiSortMeta');
  }

  // Mirrors PrimeNG's own `multisortField` tie-breaking: move to the next sort key whenever the
  // current one compares equal, in a plain loop rather than recursion so this stays at 3
  // parameters (`max-params`). A column's `comparator` returns the *ascending* result (see its
  // doc comment in `data-table.model.ts`); this is the one place that applies the requested
  // direction, by multiplying by the sort order (`1` ascending, `-1` descending) — a comparator
  // itself never re-negates for descending.
  private compareRows(a: Row, b: Row, sortMeta: readonly ResolvedSortKey[]): number {
    const rawA = getRawRow(a);
    const rawB = getRawRow(b);
    for (const meta of sortMeta) {
      const column = this.columnById(meta.colId);
      const valueGetter = column.valueGetter ?? defaultValueGetter<Row>(meta.colId);
      const comparator = column.comparator ?? defaultComparator;
      const result =
        comparator(valueGetter(rawA), valueGetter(rawB), meta.order === -1) * meta.order;
      if (result !== 0) return result;
    }
    return 0;
  }

  private columnById(colId: string): DataTableColDef<Row, unknown> {
    const column = this.columns().find((candidate) => candidate.colId === colId);
    if (!column) throw new Error(`data-table: unknown column "${colId}" in sort meta`);
    return column;
  }
}
