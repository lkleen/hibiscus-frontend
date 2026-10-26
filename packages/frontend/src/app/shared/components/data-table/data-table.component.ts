import { NgTemplateOutlet } from '@angular/common';
import { CdkMenu, CdkMenuItem, CdkContextMenuTrigger } from '@angular/cdk/menu';
import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import { CdkPortalOutlet, TemplatePortal } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  TemplateRef,
  ViewContainerRef,
  afterRenderEffect,
  computed,
  DestroyRef,
  contentChildren,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FilterMatchMode, FilterService } from 'primeng/api';
import type { TreeNode, TreeTableNode } from 'primeng/api';
import { Table, TableModule } from 'primeng/table';
import { TreeTable, TreeTableModule } from 'primeng/treetable';
import type { TreeTableSortEvent } from 'primeng/treetable';
import type { TableDensity } from '@hibiscus-frontend/shared/contracts/user-settings';
import type { TranslationKey } from '../../../core/models/translation.model';
import { APP_DIALOG_BACKDROP_CLASS, APP_DIALOG_PANEL_CLASS } from '../../dialog/dialog-classes';
import { TranslationService } from '../../../core/services/translation.service';
import { getRawRow, createColumnAccessorProxyFactory } from './column-accessor-proxy';
import { DataTableCellDirective, type DataTableCellContext } from './data-table-cell.directive';
import {
  DEFAULT_TABLE_OPTIONS,
  dashFormatter,
  defaultComparator,
  defaultValueGetter,
} from './data-table.defaults';
import {
  DEFAULT_GROUP_EXPANDED,
  requireNodeData,
  computeTreeAggregates,
  indexTreeNodes,
  sortTreeNodes,
  toTreeNodes,
  validateNoAggFuncOutsideTreeMode,
  validateTreeMode,
} from './data-table-tree';
import type { TreeAggregates } from './data-table-tree';
import { DataTableToolbarOutlet } from './data-table-toolbar-outlet';
import { isVisibleColumn, showDetailsOf } from './data-table.model';
import {
  DataTableRowDetailsComponent,
  ROW_DETAILS_TITLE_ID,
  type DataTableRowDetailsData,
} from './row-details-dialog/row-details-dialog.component';
import type {
  DataTableAutoSizeStrategy,
  DataTableRowSelection,
  DataTableContextMenuParams,
  DataTableMenuItem,
  DataTableMenuItemDef,
  DataTableShowDetailsItem,
  DataTableColDef,
  DataTableExportCell,
  DataTableExportSnapshot,
  DataTableFilterType,
  DataTableOptions,
  DataTableTreeOptions,
  DataTableVisibleColDef,
} from './data-table.model';

/** The `matchMode` name a caller-supplied `quickFilter.matcher` is registered under on this
 *  component's own `FilterService` instance — never on the app-wide `providedIn: 'root'` one. */
const QUICK_FILTER_MATCH_MODE = 'dataTableQuickFilter';

/** Row clicks that belong to a control inside the row, not to the row (see `onRowClick`). */
const ROW_CONTROL_SELECTOR: string =
  'input, button, a, label, select, textarea, ' +
  '[data-pc-column-resizer="true"], [data-pc-section="columnresizer"], .p-treetable-node-toggle-button';

/** Cell controls that PrimeNG's own row-click check misses (it skips only `input`, `textarea`,
 *  `button` and `a`): their clicks and keys would select the row and swallow Space/Enter. */
const ROW_SELECTION_EXEMPT_SELECTOR = 'select';

/**
 * Shape of `p-table`'s `(sortFunction)` payload. PrimeNG types this `EventEmitter<any>` (see
 * `types/primeng-table.d.ts`), so this interface — not `any` — is what this component's own
 * handler is typed against; the untyped boundary is PrimeNG's, not introduced here.
 */
interface DataTableSortFunctionEvent<Row> {
  readonly data: Row[];
  readonly mode: 'single' | 'multiple';
  readonly field?: string;
  readonly order?: number;
  readonly multiSortMeta?: readonly { readonly field: string; readonly order: number }[];
}

/** The serialized node PrimeNG's TreeTable hands to `rowTrackBy` and the `#body` template (its
 *  `.d.ts` types the latter wrongly; verified in `primeng-treetable.mjs` `serializeNodes`). */
export interface DataTableTreeRowNode<Row> {
  readonly node: TreeNode<Row>;
  readonly parent: TreeNode<Row> | null;
  readonly level: number;
  readonly visible: boolean;
}

/** A sort key resolved to this component's own vocabulary (`colId`, not PrimeNG's `field`). */
interface ResolvedSortKey {
  readonly colId: string;
  readonly order: 1 | -1;
}

/**
 * Shape of `p-table`'s `(onColReorder)` payload this handler reads. Unlike `(sortFunction)`,
 * PrimeNG does type this output — `EventEmitter<TableColumnReorderEvent>` (`primeng/types/table`,
 * see `types/primeng-table.d.ts`) — but that type's third field, `columns?: any[]` (the array
 * `ObjectUtils.reorderArray` would have mutated had `[columns]` been bound to `<p-table>`; see this
 * component's own class doc comment for why it isn't), is exactly the `any` this project's "no
 * `any`" rule forbids importing. This local interface, like `DataTableSortFunctionEvent` above,
 * declares only the two index fields this handler actually reads.
 */
interface DataTableColReorderEvent {
  readonly dragIndex?: number;
  readonly dropIndex?: number;
}

/**
 * The project's one generic table component — every table goes through this, never
 * `<p-table>` directly (see `CLAUDE.md` and the `angular-primeng-table` skill). Modelled on
 * ag-Grid's `ColDef`/`GridOptions`/grid API: rows stay raw, every computed value is a column
 * lambda evaluated live (see `data-table.model.ts`), and every feature is switchable off with a
 * replaceable default lambda (see `data-table.defaults.ts`).
 *
 * Setting `options.treeData` switches the same component to ag-Grid-style tree data, rendered by
 * `<p-treetable>` instead of `<p-table>` (see `DataTableTreeOptions` for what it supports and
 * `data-table-tree.ts` for the pure helpers); everything not tree-specific — cell rendering,
 * comparators, quick filter, column order/resize — is shared between the two paths.
 *
 * Besides the `p-table` features it also offers an ag-Grid-style external filter
 * (`externalFilter`) and two toolbar slots: elements marked `appDataTableToolbarStart` are projected
 * into the filters form before the search field, elements marked `appDataTableToolbar` after it
 * (see the template).
 *
 * `sortMode="multiple"` and `customSort` are fixed, not configurable — the whole point of this
 * component is that sorting always goes through column `comparator`s (`onSortFunction` below), so
 * there is no supported "let PrimeNG sort raw values" mode to switch to.
 *
 * `<p-table>`'s own `[columns]` input is deliberately left unbound. `visibleColumns` below is this
 * component's one source of truth for column order; PrimeNG's column-drag code
 * (`Table.onColumnDrop` in `primeng-table.mjs`) calls `ObjectUtils.reorderArray(this.columns, …)`
 * on whatever `[columns]` is bound to, which is a no-op against `undefined` — so binding it would
 * just give PrimeNG a second, competing copy of the order to (not) maintain. `onColReorder` below
 * applies the same move to `visibleColumns` itself, from the indices PrimeNG's drop event always
 * carries regardless of whether `[columns]` is bound.
 */
@Component({
  selector: 'app-data-table',
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TableModule,
    TreeTableModule,
    NgTemplateOutlet,
    CdkContextMenuTrigger,
    CdkMenu,
    CdkMenuItem,
  ],
  providers: [FilterService],
  host: {
    '[class.data-table-host--fill]': "scrollHeight() === 'flex'",
    '[class]': '"table-density-" + density()',
  },
})
export class DataTableComponent<Row extends object> {
  protected readonly i18n = inject(TranslationService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly filterService = inject(FilterService);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly dialog = inject(Dialog);
  private readonly destroyRef = inject(DestroyRef);
  /** A page-owned toolbar row for the trailing toolbar controls (see `DataTableToolbarOutlet`);
   *  optional — no provider means the controls render in this table's own filters form. */
  protected readonly toolbarOutlet: DataTableToolbarOutlet | null = inject(DataTableToolbarOutlet, {
    optional: true,
  });
  private readonly toolbarActions = viewChild.required<TemplateRef<unknown>>('toolbarActions');
  private readonly cellContent = viewChild.required<TemplateRef<unknown>>('cellContent');

  readonly value = input.required<readonly Row[]>();
  readonly columns = input.required<readonly DataTableColDef<Row, unknown>[]>();
  readonly options = input.required<DataTableOptions<Row>>();
  readonly loading = input<boolean>(false);

  /**
   * ag-Grid's external filter: a caller-owned predicate applied *before* the table's own column
   * filters, quick filter, sorting and paging — a row it rejects is simply not part of the table's
   * data (so the page report counts only the rows that pass, and the empty message shows when none
   * does). An `input`, not part of `options`: `options` is static configuration, whereas this
   * changes at runtime (e.g. a date-range picker in the toolbar slot). `null` shows every row.
   *
   * Contract: it is re-evaluated only when `value()` or `externalFilter()` changes — never on
   * `refresh()`. It must therefore depend on fields the caller does not mutate in place; a caller
   * whose predicate reads mutable state must pass a *new function* whenever that state changes.
   * Called with the *raw* row, like every other caller-supplied lambda.
   */
  readonly externalFilter = input<((row: Row) => boolean) | null>(null);

  /** Row density of this table (`table-density-<id>` host class, see `_primeng-table.scss`). */
  readonly density = input<TableDensity>('normal');

  /** ag-Grid's `quickFilterText`: when non-null the table's own search field is not rendered and
   *  the table filters globally with this text, exactly like typing it into that field. */
  readonly quickFilterText = input<string | null>(null);

  /**
   * Two-way: the id (`options.getRowId`) of the selected row while `options.rowSelection` is set,
   * `null` for none. A click on a row (or Enter/Space on a focused one) sets it; the caller may set
   * it too (e.g. to preselect). An id with no row in `value()` highlights nothing and is kept, so a
   * selection survives a reload that brings the row back. Ignored when `rowSelection` is unset.
   */
  readonly selectedRowId = model<string | number | null>(null);

  /**
   * Two-way: the ids (`options.getRowId`) of the selected rows while `options.rowSelection` is
   * `{ mode: 'multiple' }`. The table prunes it to the selectable rows that pass the current
   * filters (external, column and quick filter), so a bulk action never reaches a row the user
   * cannot see — this includes ids the caller sets for rows that are not in `value()` (yet).
   * Ignored when `rowSelection` is not `'multiple'`.
   */
  readonly selectedRowIds = model<ReadonlySet<string | number>>(new Set());

  private readonly cellTemplates = contentChildren(DataTableCellDirective<Row>);
  private readonly table = viewChild<Table<Row>>('dt');
  private readonly treeTable = viewChild<TreeTable>('tt');

  protected readonly q = signal('');

  private readonly proxyFactory = createColumnAccessorProxyFactory<Row>(() => this.columns());

  /** New only when `value()` or `externalFilter()` changes; proxies are reused from the factory's
   *  `WeakMap`, so their identity — and therefore PrimeNG's `filteredValue`/paging — stays stable
   *  across an in-place mutation of a raw row followed by `refresh()` (which recomputes nothing
   *  here, so an unchanged external filter keeps the user's page).
   *
   *  The external filter runs on the *raw* rows, before proxying: it is a caller lambda and, like
   *  every other one, takes raw rows. Only the survivors are mapped to proxies, and those still
   *  come from the `WeakMap` factory, so a row that stays visible across a filter change keeps its
   *  proxy identity. A filter change deliberately yields a new array identity: PrimeNG treats a new
   *  `[value]` as a new result set and resets to page 1, which is the wanted behaviour (the old
   *  page number is meaningless against different rows). Quick filter and column filters need no
   *  adaptation: PrimeNG applies them to this array, i.e. on top of the external filter. */
  protected readonly boundRows = computed<Row[]>(() => {
    const externalFilter: ((row: Row) => boolean) | null = this.externalFilter();
    const rows: readonly Row[] = this.value();
    const visible: readonly Row[] = externalFilter ? rows.filter(externalFilter) : rows;
    return visible.map((row) => this.proxyFactory.getProxy(row));
  });

  /** The validated tree options, or `null` for a flat table. Reading it is what throws on an
   *  unsupported tree-mode combination (see `validateTreeMode`), on first render. */
  private readonly treeOptions = computed<DataTableTreeOptions<Row> | null>(() => {
    const options: DataTableOptions<Row> = this.options();
    validateNoAggFuncOutsideTreeMode(options, this.columns());
    if (options.treeData === undefined) return null;
    validateTreeMode({
      options,
      columns: this.columns(),
      externalFilter: this.externalFilter(),
    });
    return options;
  });

  /** PrimeNG's own (single) selection; `'multiple'` deliberately bypasses it, see
   *  `multiSelectionEnabled`. */
  protected readonly rowSelectionEnabled = computed<boolean>(
    () => this.options().rowSelection?.mode === 'single',
  );

  /**
   * `{ mode: 'multiple' }` is driven by this component's own state (`selectedRowIds`), not by
   * PrimeNG's selection API. PrimeNG's multiple selection is page-scoped (its header checkbox
   * covers the rendered page only), has no per-row "not selectable" and no tree-leaf notion, and
   * keeps the selected *objects* (the column-accessor proxies), which our id-based, pruned model
   * would have to be mirrored into on every filter and data change. Own state needs none of that.
   */
  protected readonly multiSelectionEnabled = computed<boolean>(
    () => this.options().rowSelection?.mode === 'multiple',
  );

  /** The leading checkbox column's cell: it shifts every PrimeNG column index by one. */
  private readonly selectColumnCount = computed<number>(() =>
    this.multiSelectionEnabled() ? 1 : 0,
  );

  /** Bumped whenever PrimeNG re-filters or re-sorts (`(onFilter)`/`(onSort)`): `displayRows`
   *  reads PrimeNG's filtered result, which is not a signal. */
  private readonly viewVersion = signal(0);

  /**
   * The raw rows that pass every filter, in display (sorted) order, across all pages — the
   * universe of the header checkbox, the range select and the pruning. Flat: PrimeNG's
   * `filteredValue`, else the bound rows (which PrimeNG sorts in place). Tree: a pre-order walk of
   * PrimeNG's `filteredNodes`, else the nodes, collapsed branches included. Every dependency that
   * changes the result either is a signal read here or bumps `viewVersion`; each evaluation
   * returns a new array so an in-place re-sort is seen downstream.
   */
  private readonly displayRows = computed<readonly Row[]>(() => {
    this.viewVersion();
    if (this.treeMode()) {
      const nodes: readonly TreeNode<Row>[] = this.treeTable()?.filteredNodes ?? this.treeNodes();
      const rows: Row[] = [];
      const visit = (node: TreeNode<Row>): void => {
        rows.push(getRawRow(requireNodeData(node)));
        node.children?.forEach(visit);
      };
      nodes.forEach(visit);
      return rows;
    }
    const source: readonly Row[] = this.table()?.filteredValue ?? this.boundRows();
    return source.map((row: Row): Row => getRawRow(row));
  });

  /** `displayRows` without the rows `isRowSelectable` rejects. */
  private readonly selectableRows = computed<readonly Row[]>(() => {
    if (!this.multiSelectionEnabled()) return [];
    return this.displayRows().filter((row: Row): boolean => this.isRowSelectable(row));
  });

  private readonly selectableIds = computed<ReadonlySet<string | number>>(() => {
    const getRowId: (row: Row) => string | number = this.options().getRowId;
    return new Set(this.selectableRows().map(getRowId));
  });

  /** The selected raw rows in display order (what `getContextMenuItems` gets). */
  private readonly selectedRows = computed<readonly Row[]>(() => {
    const selected: ReadonlySet<string | number> = this.selectedRowIds();
    const getRowId: (row: Row) => string | number = this.options().getRowId;
    return this.selectableRows().filter((row: Row): boolean => selected.has(getRowId(row)));
  });

  /** Header checkbox state: over the selectable rows that pass the filters. */
  protected readonly headerSelection = computed<{
    readonly total: number;
    readonly checked: boolean;
    readonly indeterminate: boolean;
  }>(() => {
    const total: number = this.selectableIds().size;
    const count: number = this.selectedRows().length;
    return {
      total,
      checked: total > 0 && count === total,
      indeterminate: count > 0 && count < total,
    };
  });

  /** Anchor of the Shift-click range: the row last toggled (not state: never rendered). */
  private rangeAnchorId: string | number | null = null;

  /** The flat table's selected row as PrimeNG sees it (the column-accessor proxy), or `null`. */
  protected readonly selectedFlatRow = computed<Row | null>(() => {
    const id: string | number | null = this.selectedRowId();
    if (id === null || !this.rowSelectionEnabled()) return null;
    const getRowId: (row: Row) => string | number = this.options().getRowId;
    const raw: Row | undefined = this.value().find((row: Row): boolean => getRowId(row) === id);
    return raw === undefined ? null : this.proxyFactory.getProxy(raw);
  });

  protected readonly treeMode = computed<boolean>(() => this.treeOptions() !== null);

  protected readonly treeGroupColId = computed<string>(
    () => this.requireTreeOptions().treeData.groupColId,
  );

  /**
   * The tree for `<p-treetable>`. `node.data` is the column-accessor proxy of the raw row — the
   * same objects the flat path binds — so PrimeNG's filter reads `colId` through the proxy.
   *
   * A new `value()` does not create fresh nodes: `toTreeNodes` reconciles against the previous
   * nodes by row id, reusing their objects, so `node.expanded` (the user's toggles, `expandAll()`/
   * `collapseAll()`) survives data changes; `groupDefaultExpanded` only seeds new nodes. Each update
   * still yields a new root array, so PrimeNG re-sorts, re-filters and re-serializes. Changed tree
   * options start from scratch (no previous nodes).
   */
  protected readonly treeNodes = linkedSignal<
    { readonly rows: readonly Row[]; readonly options: DataTableTreeOptions<Row> },
    TreeNode<Row>[]
  >({
    source: () => ({ rows: this.value(), options: this.requireTreeOptions() }),
    computation: (source, previous) =>
      toTreeNodes(source.rows, {
        getId: source.options.getRowId,
        getParentId: source.options.treeData.getParentId,
        getData: (row: Row): Row => this.proxyFactory.getProxy(row),
        groupDefaultExpanded:
          source.options.treeData.groupDefaultExpanded ?? DEFAULT_GROUP_EXPANDED,
        previous:
          previous && previous.source.options === source.options
            ? indexTreeNodes(previous.value)
            : new Map<string, TreeNode<Row>>(),
      }),
  });

  /** The tree's selected node, or `null` (see `selectedFlatRow`). Node keys are `String(id)`. */
  protected readonly selectedTreeNode = computed<TreeNode<Row> | null>(() => {
    const id: string | number | null = this.selectedRowId();
    if (id === null || !this.rowSelectionEnabled()) return null;
    return indexTreeNodes(this.treeNodes()).get(String(id)) ?? null;
  });

  /** `aggFunc` aggregates of the current `treeNodes` (empty when no column aggregates); recomputed
   *  on every `treeNodes` update (each yields a new root array). */
  private readonly treeAggregates = computed<TreeAggregates<Row>>(() =>
    computeTreeAggregates(this.treeNodes(), this.columns()),
  );

  /** Tree mode's `scrollHeight`: a CSS length becomes the wrapper's `max-height`; `'flex'` is
   *  handled by the host class, `false` leaves the wrapper unbounded. */
  protected readonly treeMaxHeight = computed<string | null>(() => {
    const height: string | undefined = this.scrollHeight();
    return height === undefined || height === 'flex' ? null : height;
  });

  // `isVisibleColumn` is a type guard (`data-table.model.ts`), so this narrows to
  // `DataTableVisibleColDef` — every rendered-columns-only code path (the header row, this array's
  // consumers below) gets `headerKey` known to exist, with no cast.
  //
  // A `linkedSignal`, not a plain `computed`: column order is session state that a drag-and-drop
  // (`onColReorder` below) moves independently of `columns()`'s own order — a `computed` has no
  // settable state of its own, so it could never hold a moved order. `linkedSignal` recomputes from
  // `columns()` (the `filter` above) whenever *that* signal's value changes — i.e. the order resets
  // whenever a new `columns` array is passed in, or the table is recreated — and otherwise just
  // holds whatever `.set()` last wrote in `onColReorder`. That's exactly `columnReorder`'s
  // session-only contract (see its doc comment in `data-table.model.ts`).
  protected readonly visibleColumns = linkedSignal<readonly DataTableVisibleColDef<Row, unknown>[]>(
    () => this.columns().filter(isVisibleColumn),
  );

  protected readonly reorderEnabled = computed<boolean>(
    () => this.options().columnReorder ?? DEFAULT_TABLE_OPTIONS.columnReorder,
  );

  protected readonly contextMenuEnabled = computed<boolean>(
    () => this.options().getContextMenuItems !== undefined,
  );

  /** The cell last right-clicked. Written by the `<td>`'s `contextmenu` handler, which runs before
   *  the `<tr>`'s CDK trigger opens the menu (bubbling), so the menu always reads the clicked
   *  cell; a second right-click overwrites it and CDK replaces the open menu. */
  private readonly contextTarget = signal<{
    readonly column: DataTableVisibleColDef<Row, unknown>;
    readonly row: Row;
  } | null>(null);

  /** The open details dialog, if any. */
  private detailsRef: DialogRef<void, DataTableRowDetailsComponent<object>> | null = null;

  /** `getContextMenuItems` of the right-clicked cell, with the details entries resolved. Read by
   *  `onCellContextMenu` (empty: no menu) and by the menu template. */
  protected readonly contextMenuItems = computed<readonly (DataTableMenuItemDef | 'separator')[]>(
    () => {
      const target: { column: DataTableVisibleColDef<Row, unknown>; row: Row } | null =
        this.contextTarget();
      if (!target) throw new Error('data-table: context menu opened without a clicked cell');
      const getItems:
        ((params: DataTableContextMenuParams<Row>) => readonly DataTableMenuItem[]) | undefined =
        this.options().getContextMenuItems;
      if (!getItems) throw new Error('data-table: context menu opened without getContextMenuItems');
      const params: DataTableContextMenuParams<Row> = {
        row: target.row,
        column: target.column,
        value: this.cellView(target.column, target.row).value,
        selectedRows: this.selectedRows(),
      };
      return getItems(params).map((item: DataTableMenuItem): DataTableMenuItemDef | 'separator' => {
        if (item === 'separator') return item;
        if (item === 'showDetails') {
          return this.showDetailsEntry(showDetailsOf(this.visibleColumns(), target.row));
        }
        if ('showDetails' in item) return this.showDetailsEntry(item);
        return item;
      });
    },
  );

  protected readonly emptyColspan = computed<number>(
    () => this.visibleColumns().length + this.selectColumnCount(),
  );

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

  protected readonly rowHover = computed<boolean>(
    () => this.options().rowHover ?? DEFAULT_TABLE_OPTIONS.rowHover,
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

  /**
   * `(selectionChange)` of both PrimeNG tables. With `metaKeySelection` off, PrimeNG toggles a
   * click on the selected row off and emits `null`: that is not a selection change here, so the
   * selection is put back (`restoreSelection`). Anything else is the clicked row/node.
   */
  protected onFlatSelectionChange(selection: Row | null): void {
    if (selection === null) {
      this.restoreSelection();
      return;
    }
    this.selectedRowId.set(this.options().getRowId(getRawRow(selection)));
  }

  protected onTreeSelectionChange(selection: TreeTableNode | TreeTableNode[] | null): void {
    if (selection === null) {
      this.restoreSelection();
      return;
    }
    if (Array.isArray(selection)) throw new Error('data-table: single selection emitted an array');
    this.selectedRowId.set(this.options().getRowId(getRawRow(requireNodeData(selection))));
  }

  /**
   * PrimeNG dropped its own selection on the re-click, while our `[selection]` binding still holds
   * the same object and so will never push it again. Write it back, and clear the flag PrimeNG
   * sets for "the next `[selection]` change comes from my own click": that change never arrives, so
   * the flag would swallow the next (external) one and leave the highlight stale.
   */
  private restoreSelection(): void {
    const table: Table<Row> | undefined = this.table();
    if (table) {
      table.selection = this.selectedFlatRow();
      table.preventSelectionSetterPropagation = false;
      return;
    }
    const tree: TreeTable | undefined = this.treeTable();
    if (!tree) throw new Error('data-table: selection changed without a rendered table');
    tree.selection = this.selectedTreeNode();
    tree.preventSelectionSetterPropagation = false;
  }

  /** `(onFilter)`/`(onSort)` of both PrimeNG tables. */
  protected onViewChange(): void {
    this.viewVersion.update((version: number): number => version + 1);
  }

  private isRowSelectable(row: Row): boolean {
    const selection: DataTableRowSelection<Row> | undefined = this.options().rowSelection;
    if (selection?.mode !== 'multiple') {
      throw new Error("data-table: row selectability asked without rowSelection 'multiple'");
    }
    return selection.isRowSelectable?.(row) ?? true;
  }

  protected isRowChecked(row: Row): boolean {
    return this.selectedRowIds().has(this.options().getRowId(getRawRow(row)));
  }

  /** Whether the row gets a checkbox (`isRowSelectable`). */
  protected isRowCheckable(row: Row): boolean {
    return this.isRowSelectable(getRawRow(row));
  }

  protected onHeaderCheckboxClick(): void {
    const next = new Set<string | number>(this.selectedRowIds());
    const selectAll = !this.headerSelection().checked;
    for (const id of this.selectableIds()) {
      if (selectAll) next.add(id);
      else next.delete(id);
    }
    this.selectedRowIds.set(next);
  }

  /** The row checkbox. Shift extends to the range (flat only), like a Shift-click on the row. */
  protected onRowCheckboxClick(event: MouseEvent, row: Row): void {
    this.toggleRow(getRawRow(row), event.shiftKey);
  }

  /** A click on the row itself: only Ctrl/Cmd (toggle) and Shift (range) do anything. Clicks that
   *  belong to a control inside the row (checkbox, tree toggler, inputs, the resize handle) are
   *  theirs. */
  protected onRowClick(event: MouseEvent, row: Row): void {
    if (!this.multiSelectionEnabled()) return;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(ROW_CONTROL_SELECTOR)) return;
    const raw: Row = getRawRow(row);
    if (!this.isRowSelectable(raw)) return;
    this.toggleRow(raw, event.shiftKey && !event.ctrlKey && !event.metaKey);
  }

  /** Keeps a click or key on a cell's `select` from reaching PrimeNG's selectable row, which would
   *  select the row (re-rendering it under the open picker) and cancel the key's default. */
  protected onCellControlEvent(event: Event): void {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(ROW_SELECTION_EXEMPT_SELECTOR)) event.stopPropagation();
  }

  /** Stops the browser's text selection from a Shift-click, which would paint over the range. */
  protected onRowMouseDown(event: MouseEvent): void {
    if (!this.multiSelectionEnabled()) return;
    if (event.shiftKey && event.target instanceof Element) {
      if (!event.target.closest(ROW_CONTROL_SELECTOR)) event.preventDefault();
    }
  }

  /**
   * Toggles `raw`, or — `range`, flat table, with an anchor that is still displayed — adds every
   * selectable row between the anchor and `raw` in display order. The clicked row becomes the
   * anchor either way. Reads `selectedRowIds()` at call time and writes one new set, so two clicks
   * never overwrite each other.
   */
  private toggleRow(raw: Row, range: boolean): void {
    const getRowId: (row: Row) => string | number = this.options().getRowId;
    const id: string | number = getRowId(raw);
    const next = new Set<string | number>(this.selectedRowIds());
    const rows: readonly Row[] = this.displayRows();
    const anchorIndex: number =
      range && !this.treeMode() && this.rangeAnchorId !== null
        ? rows.findIndex((row: Row): boolean => getRowId(row) === this.rangeAnchorId)
        : -1;
    if (anchorIndex === -1) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      const clickedIndex: number = rows.findIndex((row: Row): boolean => getRowId(row) === id);
      if (clickedIndex === -1) throw new Error('data-table: toggled row is not displayed');
      const from: number = Math.min(anchorIndex, clickedIndex);
      const to: number = Math.max(anchorIndex, clickedIndex);
      for (const row of rows.slice(from, to + 1)) {
        if (this.isRowSelectable(row)) next.add(getRowId(row));
      }
    }
    this.rangeAnchorId = id;
    this.selectedRowIds.set(next);
  }

  protected readonly rowTrackBy = (_index: number, row: Row): string | number =>
    this.options().getRowId(getRawRow(row));

  protected readonly treeRowTrackBy = (
    _index: number,
    serialized: DataTableTreeRowNode<Row>,
  ): string | number => this.options().getRowId(getRawRow(requireNodeData(serialized.node)));

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

    // The details dialog renders this component's `#cellContent` template, so it must not outlive it.
    this.destroyRef.onDestroy((): void => this.detailsRef?.close());

    // Prune the selection to the selectable rows that pass the filters. After render, not in an
    // `effect`: PrimeNG applies a new `[value]` and re-filters during change detection, so only
    // then is its filtered result current. `kept` is a subset of `selected`, so comparing sizes is
    // exact and the write cannot retrigger itself.
    afterRenderEffect((): void => {
      if (!this.multiSelectionEnabled()) return;
      const selected: ReadonlySet<string | number> = this.selectedRowIds();
      const allowed: ReadonlySet<string | number> = this.selectableIds();
      const kept = new Set<string | number>(
        [...selected].filter((id: string | number): boolean => allowed.has(id)),
      );
      if (kept.size !== selected.size) this.selectedRowIds.set(kept);
    });

    // `quickFilterText`: drives the same path as the own field. Waits for the table to render;
    // when it returns to null the previously applied external text is cleared (field is empty).
    let externalApplied = false;
    effect((): void => {
      const text: string | null = this.quickFilterText();
      this.quickFilterMatchMode();
      if (!this.table() && !this.treeTable()) return;
      if (text !== null) {
        untracked((): void => this.applyQuickFilter(text));
        externalApplied = true;
      } else if (externalApplied) {
        externalApplied = false;
        untracked((): void => this.applyQuickFilter(''));
      }
    });

    // Trailing toolbar controls (projected toolbar content, tree controls) into the page's toolbar
    // row, when it offers one. On a tab switch the next
    // table may attach before this one is destroyed: it detaches whatever is there, and this
    // cleanup then only detaches its own portal.
    effect((onCleanup): void => {
      const outlet: CdkPortalOutlet | undefined = this.toolbarOutlet?.outlet();
      if (!outlet) return;
      const portal: TemplatePortal = new TemplatePortal(
        this.toolbarActions(),
        this.viewContainerRef,
      );
      if (outlet.hasAttached()) outlet.detach();
      outlet.attach(portal);
      onCleanup((): void => {
        if (outlet.portal === portal) outlet.detach();
      });
    });
  }

  /** Runs before the `<tr>`'s CDK trigger. A cell without menu entries stops the event there, so
   *  the trigger never opens an empty menu and the browser's own one shows. */
  protected onCellContextMenu(
    event: MouseEvent,
    column: DataTableVisibleColDef<Row, unknown>,
    row: Row,
  ): void {
    if (!this.contextMenuEnabled()) return;
    this.contextTarget.set({ column, row: getRawRow(row) });
    if (this.contextMenuItems().length === 0) event.stopPropagation();
  }

  private showDetailsEntry(details: DataTableShowDetailsItem): DataTableMenuItemDef {
    return { nameKey: 'table.menuView', action: (): void => this.openRowDetails(details) };
  }

  private openRowDetails({ showDetails }: DataTableShowDetailsItem): void {
    this.detailsRef?.close();
    const data: DataTableRowDetailsData<object> = {
      cellContent: this.cellContent(),
      columns: showDetails.columns.filter(isVisibleColumn),
      row: showDetails.row,
    };
    const ref: DialogRef<void, DataTableRowDetailsComponent<object>> = this.dialog.open<
      void,
      DataTableRowDetailsData<object>,
      DataTableRowDetailsComponent<object>
    >(DataTableRowDetailsComponent, {
      data,
      ariaLabelledBy: ROW_DETAILS_TITLE_ID,
      panelClass: APP_DIALOG_PANEL_CLASS,
      backdropClass: APP_DIALOG_BACKDROP_CLASS,
    });
    this.detailsRef = ref;
    ref.closed.subscribe((): void => {
      if (this.detailsRef === ref) this.detailsRef = null;
    });
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
    this.applyQuickFilter((event.target as HTMLInputElement).value);
  }

  private applyQuickFilter(value: string): void {
    this.q.set(value);
    const table: Table<Row> | TreeTable | undefined = this.treeMode()
      ? this.treeTable()
      : this.table();
    if (!table) throw new Error('data-table: search input used before the table was rendered');
    table.filterGlobal(value, this.quickFilterMatchMode());
  }

  /** Tree mode's column filter (PrimeNG's TreeTable has no filter component): a plain text input
   *  per column that calls the table's own `filter()` — debounced by PrimeNG, `contains`, applied
   *  through the column-accessor proxy exactly like the flat path's text filter. */
  protected onTreeColumnFilter(event: Event, column: DataTableColDef<Row, unknown>): void {
    const table: TreeTable | undefined = this.treeTable();
    if (!table) throw new Error('data-table: column filter used outside tree mode');
    table.filter((event.target as HTMLInputElement).value, column.colId, FilterMatchMode.CONTAINS);
  }

  /** ag-Grid's `expandAll()`: expands every node in place. Tree mode only. */
  expandAll(): void {
    this.setAllExpanded(true);
  }

  /** ag-Grid's `collapseAll()`: collapses every node in place. Tree mode only. */
  collapseAll(): void {
    this.setAllExpanded(false);
  }

  /** Mutates `expanded` on the current nodes (later data updates reuse them, so the state holds),
   *  then publishes a new root array so PrimeNG re-serializes. */
  private setAllExpanded(expanded: boolean): void {
    this.requireTreeOptions();
    const roots: TreeNode<Row>[] = this.treeNodes();
    const visit = (node: TreeNode<Row>): void => {
      node.expanded = expanded;
      node.children?.forEach(visit);
    };
    roots.forEach(visit);
    this.treeNodes.set([...roots]);
  }

  private requireTreeOptions(): DataTableTreeOptions<Row> {
    const options: DataTableTreeOptions<Row> | null = this.treeOptions();
    if (!options) throw new Error('data-table: tree mode is not enabled (options.treeData)');
    return options;
  }

  /** ag-Grid-style `refreshCells()`: repaints without rebuilding anything. A feature that mutates
   *  a raw row in place (e.g. a category change) only needs this — values are computed live, so
   *  there is nothing to recompute ahead of time. */
  refresh(): void {
    this.cdr.markForCheck();
  }

  /** What the table shows right now, for an export: the visible columns in the user's current
   *  order, and the rows after every filter in display order (all pages). `cell` gives a cell's
   *  value (the aggregate for a tree group node) and its rendered text. */
  exportSnapshot(): DataTableExportSnapshot<Row> {
    const snapshot: DataTableExportSnapshot<Row> = {
      columns: this.visibleColumns(),
      rows: this.displayRows(),
      cell: (column: DataTableColDef<Row, unknown>, row: Row): DataTableExportCell => {
        const { value, formatted } = this.cellView(column, row);
        return { value, formatted };
      },
    };
    return snapshot;
  }

  protected cellView(
    column: DataTableColDef<Row, unknown>,
    row: Row,
  ): { readonly raw: Row; readonly value: unknown; readonly formatted: string } {
    const raw = getRawRow(row);
    const valueGetter = column.valueGetter ?? defaultValueGetter<Row>(column.colId);
    const value = this.aggregateOf(column, raw) ?? valueGetter(raw);
    const formatter = column.valueFormatter ?? dashFormatter;
    return { raw, value, formatted: formatter(value, raw) };
  }

  /** The `aggFunc` aggregate of a group node's column, `undefined` for a leaf, a flat table or a
   *  column without `aggFunc`. */
  private aggregateOf(column: DataTableColDef<Row, unknown>, raw: Row): number | undefined {
    if (column.aggFunc === undefined) return undefined;
    return this.treeAggregates().get(raw)?.get(column.colId);
  }

  protected templateFor(rendererName: string): TemplateRef<DataTableCellContext<Row>> {
    const template = this.cellTemplatesByRenderer().get(rendererName);
    if (!template) {
      throw new Error(`data-table: no cell template registered for cellRenderer "${rendererName}"`);
    }
    return template;
  }

  /**
   * Makes the whole header cell a drag source. PrimeNG's `ReorderableColumn.onMouseDown` sets the
   * `th` draggable only when `findSingle(event.target, '[data-pc-column-resizer="true"]')` finds
   * nothing — but `findSingle` searches the target's *descendants*, so a press on the `th` itself
   * (its text node or padding) finds the resize handle inside it and switches dragging off; only a
   * press on a child like the sort icon could start a drag (verified in the browser). This runs on
   * the `tr`, i.e. after PrimeNG's own listener on the `th`, and applies the check PrimeNG meant:
   * is the press *inside* the resize handle or an input. (PrimeNG's check also gets the handle
   * itself wrong — a press on it finds no descendant, so the `th` became draggable — hence the
   * explicit `false` too.)
   */
  protected onHeaderMouseDown(event: MouseEvent): void {
    if (!this.reorderEnabled() || !(event.target instanceof Element)) return;
    const th = event.target.closest('th');
    if (!th) return;
    // `p-table` marks its resize handle `data-pc-column-resizer`, `p-treetable` `data-pc-section`.
    th.draggable = !event.target.closest(
      '[data-pc-column-resizer="true"], [data-pc-section="columnresizer"], input, textarea',
    );
  }

  /**
   * `(onColReorder)` handler. PrimeNG never mutates `columns()`/`visibleColumns()` itself when
   * `<p-table>`'s `[columns]` is left unbound (see this component's class doc comment) — it always
   * emits `dragIndex`/`dropIndex` regardless, so this applies the move to `visibleColumns` itself,
   * with the same `splice(to, 0, splice(from, 1)[0])` semantics as PrimeNG's own
   * `ObjectUtils.reorderArray` (verified in `primeng-utils.mjs`). Unlike PrimeNG's version, an
   * out-of-range index throws rather than silently wrapping (`% length`): PrimeNG only takes that
   * branch when `dropIndex >= length`, which a real drag can't produce (both indices come from
   * `DomHandler.indexWithinGroup`, i.e. the position of an existing header `th`), so reaching it
   * here means the event is malformed — core.md's fail-loud rule says that throws, not silently
   * self-corrects.
   */
  protected onColReorder(event: DataTableColReorderEvent): void {
    const { dragIndex: rawDragIndex, dropIndex: rawDropIndex } = event;
    if (rawDragIndex === undefined || rawDropIndex === undefined) {
      throw new Error('data-table: onColReorder event missing dragIndex/dropIndex');
    }
    // PrimeNG counts header cells, the checkbox column's included (it is not reorderable itself).
    const dragIndex: number = rawDragIndex - this.selectColumnCount();
    const dropIndex: number = rawDropIndex - this.selectColumnCount();
    const columns = [...this.visibleColumns()];
    if (
      dragIndex < 0 ||
      dragIndex >= columns.length ||
      dropIndex < 0 ||
      dropIndex >= columns.length
    ) {
      throw new Error(
        `data-table: onColReorder index out of range ` +
          `(dragIndex=${dragIndex}, dropIndex=${dropIndex}, length=${columns.length})`,
      );
    }
    const [moved] = columns.splice(dragIndex, 1);
    columns.splice(dropIndex, 0, moved);
    this.visibleColumns.set(columns);
  }

  protected onSortFunction(event: DataTableSortFunctionEvent<Row>): void {
    const sortMeta = this.resolveSortMeta(event);
    event.data.sort((a, b) => this.compareRows(a, b, sortMeta));
  }

  /** `(sortFunction)` of `<p-treetable>`: sorts the whole tree within each level, with the same
   *  comparators as the flat path. */
  protected onTreeSortFunction(event: TreeTableSortEvent): void {
    // In multiple mode PrimeNG hands over the *root* array on every emission (children never
    // arrive), so the whole tree is sorted from it; see `sortTreeNodes`.
    if (!event.data) throw new Error('data-table: tree sortFunction event has no data');
    const sortMeta: readonly ResolvedSortKey[] = this.resolveSortMeta(event);
    sortTreeNodes(event.data, (a: Row, b: Row) => this.compareRows(a, b, sortMeta));
  }

  private resolveSortMeta(event: {
    readonly field?: string;
    readonly order?: number;
    readonly multiSortMeta?: readonly { readonly field: string; readonly order: number }[] | null;
  }): readonly ResolvedSortKey[] {
    if (event.multiSortMeta) {
      return event.multiSortMeta.map((meta) => ({
        colId: meta.field,
        order: this.toSortOrder(meta.order),
      }));
    }
    if (event.field && event.order) {
      return [{ colId: event.field, order: this.toSortOrder(event.order) }];
    }
    throw new Error('data-table: sortFunction event has neither field nor multiSortMeta');
  }

  private toSortOrder(order: number): 1 | -1 {
    if (order !== 1 && order !== -1) {
      throw new Error(`data-table: sort order must be 1 or -1, got ${order}`);
    }
    return order;
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
      const valueA: unknown = this.aggregateOf(column, rawA) ?? valueGetter(rawA);
      const valueB: unknown = this.aggregateOf(column, rawB) ?? valueGetter(rawB);
      const result = comparator(valueA, valueB, meta.order === -1) * meta.order;
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
