# Column reordering (drag-and-drop) for `<app-data-table>`


## Context

You want to be able to move table columns. Per `CLAUDE.md`, table features go into the generic
`<app-data-table>` as switchable options, never into a single feature, so every table gets this
feature (transactions, accounts, …).
Decision (asked): **the order is kept for the session only.** It lives in component state, resets
on reload or navigation, and matches ag-Grid's default behaviour. There is no localStorage.

## Verified PrimeNG 21.1.10 mechanics (read from `node_modules/primeng/fesm2022/primeng-table.mjs`)

- `<p-table [reorderableColumns]>` plus `pReorderableColumn` on each header `th` enables native
  HTML5 drag-and-drop. The drag starts from the header cell. `mousedown` on an input or on the
  resize handle suppresses the drag, so resizing still works. Clicking to sort still works.
- `onColumnDrop` computes `dragIndex`/`dropIndex` with `DomHandler.indexWithinGroup(th,
  'preorderablecolumn')`, which counts the sibling `th`s that carry the attribute. It then calls
  `ObjectUtils.reorderArray(this.columns, …)`, which does nothing when `[columns]` is unbound
  (`if (value && …)`), and **always emits `(onColReorder)` `{ dragIndex, dropIndex, columns }`**.
  The plan relies on this: we don't bind `[columns]`, so PrimeNG never mutates our arrays. We apply
  the move ourselves from the two indices.
- When columns were resized, PrimeNG already reorders its generated width `<style>` on drop, so
  resized widths follow the moved column.
- `ReorderableColumn` binds its listeners once, in `onAfterViewInit`, and only when
  `pReorderableColumnDisabled !== true`. As with `resizable`, toggling it at runtime has no effect.
- The drop indicator colour comes from the `--p-datatable-drop-point-color` token (Aura
  `dropPoint.color`).

## Changes

### 1. `data-table.model.ts`
Add a grid option to `DataTableOptions`, modelled on ag-Grid's movable columns (ag-Grid's
`suppressMovableColumns`, inverted to match the positive naming of `columnResize`/`striped`):
```ts
/** Drag-and-drop column reordering by header. Default `true`. The order is session state only —
 *  kept while the component lives, reset when `columns` changes or the table is recreated. */
readonly columnReorder?: boolean;
```
No per-column opt-out (YAGNI; add ag-Grid's `suppressMovable` if a table ever needs one).

### 2. `data-table.defaults.ts`
Add `columnReorder: true` to `DEFAULT_TABLE_OPTIONS` and to its type.

### 3. `data-table.component.ts`
- `reorderEnabled = computed(() => this.options().columnReorder ?? DEFAULT_TABLE_OPTIONS.columnReorder)`.
- Turn `visibleColumns` into a **`linkedSignal`** (stable API) derived from
  `this.columns().filter(isVisibleColumn)`. A new `columns` input resets the order, and a drop
  `.update()`s it. Everything that reads `visibleColumns()` (header, filter row, body,
  `emptyColspan`, `globalFilterFields`, `columnMinWidths`) then follows the new order
  automatically.
- `onColReorder(event: { dragIndex: number; dropIndex: number })`: copy the array, splice the moved
  column from `dragIndex` to `dropIndex` (the same semantics as `reorderArray`), and set it. Throw
  when an index is out of range, to fail loudly per `core.md`. PrimeNG types the output
  `EventEmitter<TableColReorderEvent>`, or `any`. Check this in `types/primeng-table.d.ts` and type
  the handler parameter the same way as the existing `DataTableSortFunctionEvent`.
- Race check: the drop handler runs synchronously inside the zone (the `drop` host listener), and
  the signal write triggers OnPush change detection. The `@for … track column.colId` moves the
  existing DOM nodes, so column filter inputs keep their values. No async gap.

### 4. `data-table.component.html`
- On `<p-table>`: `[reorderableColumns]="reorderEnabled()"` and
  `(onColReorder)="onColReorder($event)"`.
- On **both** header `th` branches (sortable and non-sortable): add a static `pReorderableColumn`.
  It must be on every header `th`, or `indexWithinGroup` indices won't match `visibleColumns`. Also
  add `[pReorderableColumnDisabled]="!reorderEnabled()"`.
- Leave the filter-row `th`s alone. Rows are driven by `visibleColumns()`, so they follow.

### 5. Theming: `src/styles/_primeng-table.scss`
Add a layer-1 token `--app-table-drop-point-color: var(--color-accent);` next to
`--app-table-resize-indicator-color`, and bridge it with
`--p-datatable-drop-point-color: var(--app-table-drop-point-color);`. No per-theme overrides are
needed.

### 6. Tests: `data-table.component.spec.ts`
Add to the existing spec, following its current harness style:
- `(onColReorder)` with `{dragIndex: 0, dropIndex: 2}` reorders the header texts, the filter cells
  and the body cells alike.
- The order resets when a new `columns` array is set.
- `columnReorder: false` means `p-table`'s `reorderableColumns` is false and the header `th`s have
  `pReorderableColumnDisabled`.
- An out-of-range index throws.

Trigger the reorder through the `Table` output, i.e. `table.onColReorder.emit(...)`, not a
simulated HTML5 drag, which happy-dom doesn't support.

### 7. Docs
- `docs/architecture.md`, frontend package bullet: mention drag-reorder of columns (session-only)
  next to drag-resize.
- The `angular-primeng-table` skill, "Verified PrimeNG 21 mechanics": add a **Column reorder**
  bullet covering the unbound `[columns]` plus `onColReorder` index approach, the requirement that
  every header `th` carries `pReorderableColumn`, and the width `<style>` being reordered on drop.

## Execution (subagents, cheapest sufficient model)

- Steps 1–4 and 6: one **sonnet** subagent. The files are coupled, and it has to verify the
  `onColReorder` typing in the installed `.d.ts`.
- Steps 5 and 7: one **haiku** subagent in parallel (CSS token and docs text only).

## Verification

1. From the repo root: `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build`.
   Everything must pass without warnings.
2. In the browser: `pnpm start:local`, then open `/en/transactions`:
   - Drag a header onto another header. The drop indicator shows in the accent colour, and the
     header, filter and body cells all move together.
   - Clicking a header still sorts. Dragging the resize handle still resizes and doesn't start a
     reorder. After resizing and then moving a column, its width moves with it.
   - Paging, filtering and sorting keep the new order. A reload restores the default order.
   - Check the accounts table too, and switch to one other theme and dark mode to check the
     indicator colour.

## Sub-phases

### Phase A — Component, model, defaults, template, tests (steps 1–4, 6)
- **Status:** done
- **Started:** 2026-09-29 22:49
- **Ended:** 2026-09-29 23:01

### Phase B — Theming bridge token and docs (steps 5, 7)
- **Status:** done
- **Started:** 2026-09-29 22:49
- **Ended:** 2026-09-29 22:52

### Phase C — Quality gate and browser verification
- **Status:** done
- **Started:** 2026-09-29 22:58
- **Ended:** 2026-09-29 23:01

Note: the out-of-range test calls the component's `onColReorder` directly — Angular's template
listener routes a handler's throw to the error handler instead of back to `.emit()`'s caller. The
build's initial-bundle budget warning (~630 kB) predates this change (+0.12 kB).
