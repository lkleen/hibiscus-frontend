# Column sizing for `<app-data-table>` (ag-Grid `autoSizeStrategy` + drag-resize)

Status: done

## Goal

Give `<app-data-table>` ag-Grid's column-sizing surface:

1. **`autoSizeStrategy`** (grid option) — `fitGridWidth`, `fitProvidedWidth`, `fitCellContents`.
2. **Drag-resize** — ColDef `resizable`, grid option `columnResize` (PrimeNG `resizableColumns` +
   `pResizableColumn`).

The transactions table switches to `fitCellContents`.

## Decisions (settled with the user, 2026-09-29)

- **Only the two features above** are in scope. There are no per-ColDef `width`/`flex`.
- **Content sizing stays native.** `fitCellContents` is done in CSS (auto table layout,
  `width: max-content`, `nowrap`), not by measuring cells in JS. That keeps us within
  `frontend.md`'s "no JS layout decisions" rule without adding an exception. The trade-off: widths
  are computed from the page being shown, so they can change when you switch pages.
- **Resize is on by default, in `'expand'` mode** (ag-Grid's default behaviour: dragging changes
  the table's width, and the table scrolls horizontally). Side effect: PrimeNG's
  `.p-datatable-resizable-table` makes every cell `white-space: nowrap; overflow: hidden`, so text
  that wraps today becomes single-line.
- **Widths are px numbers, as in ag-Grid.** PrimeNG's resize reads a header's inline `min-width`
  with `replace(/[^\d.]/g, '')` and treats it as px (`primeng-table.mjs`, `onColumnResizeEnd`),
  so `'8rem'` would silently become an 8px floor. The existing table-level `minWidth` option stays
  a CSS string, unchanged.

## Verified PrimeNG 21.1.10 mechanics

- `.p-datatable-table { width: 100% }` with auto table layout. That already *is* `fitGridWidth`
  with no limits, so the default strategy changes nothing visually.
- Resize (`onColumnResizeEnd`): the floor is the `th`'s inline `style.minWidth` (px), default 15.
  `'fit'` takes the delta from the next column. `'expand'` writes `style.width`/`style.minWidth` on
  the `<table>`. Both then pin **every** column through a generated `<style>` element:
  `th/td:nth-child(n) { width: Npx !important; max-width: Npx !important }`. The selector
  `.p-datatable-thead > tr > th` also matches the filter row, so its cells follow automatically.
- Hidden columns are never rendered, so `nth-child` indices match `visibleColumns()`.
- `pResizableColumnDisabled` turns off one column's handle. PrimeNG creates the handle (once, in
  `ngAfterViewInit`) whenever that is not `true`, *regardless of the table's `resizableColumns`*, so
  `columnResize: false` must also set it on every header cell. In `'fit'` mode the last column's
  handle is hidden by PrimeNG's own CSS.
- There is no keyboard resize (the resizer is a mouse/touch-only `span`). This is a PrimeNG
  limitation and is documented, not worked around.

## API

`data-table.model.ts`:

```ts
export interface DataTableColumnLimit {
  readonly colId: string;
  readonly minWidth: number; // px — no maxWidth, see Phase D
}

export type DataTableAutoSizeStrategy =
  | {
      readonly type: 'fitGridWidth';
      readonly defaultMinWidth?: number; // px, every column without its own limit
      readonly columnLimits?: readonly DataTableColumnLimit[];
    }
  | { readonly type: 'fitProvidedWidth'; readonly width: number } // px
  | { readonly type: 'fitCellContents' };

// DataTableColDefBase
readonly resizable?: boolean; // default true; ignored when options.columnResize is false

// DataTableOptions
readonly autoSizeStrategy?: DataTableAutoSizeStrategy; // default { type: 'fitGridWidth' }
readonly columnResize?: false | { readonly mode: 'fit' | 'expand' }; // default { mode: 'expand' }
```

How each strategy maps to CSS (all on `<p-table>`'s `tableStyle` and on the header `th`s):

| Strategy           | Table                            | Columns                                                          |
|--------------------|----------------------------------|-------------------------------------------------------------------|
| `fitGridWidth`     | `width: 100%` (PrimeNG default)  | `min-width` px from `columnLimits` / `defaultMinWidth`            |
| `fitProvidedWidth` | `width: <width>px`               | natural                                                           |
| `fitCellContents`  | `width: max-content`             | `nowrap` (a `data-table--fit-contents` class)                      |

`options.minWidth` still applies on top of every strategy.

A `columnLimits` entry whose `colId` isn't a visible column throws, the same way `columnById`
already fails loudly.

## Risks to verify in the browser

- **`max-width` on table cells.** With auto layout, browsers may ignore `max-width` on `th`/`td`.
  If Chrome does, apply the limit to an inner `.data-table__cell` wrapper instead (`max-width`,
  `overflow: hidden`, `text-overflow: ellipsis`), because the column takes its width from its
  content.
- **`tableStyle` vs. `'expand'`.** After a resize, PrimeNG writes `style.width` on the `<table>`.
  `tableStyle` is a `computed` with a stable identity, so change detection should not write
  `width: max-content` back over it. Confirm by resizing, then paging/sorting/filtering, and
  checking that the dragged width stays.
- **Theming.** The resize indicator colour comes from `--p-datatable-resize-indicator-color`. Add
  it to the bridge in `_primeng-table.scss` (layer 1 `--app-table-resize-indicator-color:
  var(--color-accent)`) so every theme renders it.

## Execution

| Phase | Agent / model            | Order                 | Scope                                                                                     |
|-------|--------------------------|-----------------------|-------------------------------------------------------------------------------------------|
| A     | general-purpose / sonnet | first                 | model types, defaults, component, template, SCSS, bridge token                            |
| B     | general-purpose / haiku  | after A, parallel w/ C | specs: `data-table.component.spec.ts`, `data-table.defaults.spec.ts`                     |
| C     | general-purpose / haiku  | after A, parallel w/ B | transactions opt-in, docs (`architecture.md`, both skills)                               |
| D     | main session             | after B + C           | browser verification of the three risks above, `max-width` fallback if needed             |
| E     | main session             | last                  | quality gates: `format:fix`, `format:check`, `lint`, `test`, `build`                     |

### Phase A — Component
- **Status:** done
- **Started:** 2026-09-29 18:53
- **Ended:** 2026-09-29 19:02

1. `data-table.model.ts`: add the types above, with doc comments in the existing style
   (ag-Grid equivalent, px unit and why).
2. `data-table.defaults.ts`: `DEFAULT_TABLE_OPTIONS.autoSizeStrategy = { type: 'fitGridWidth' }`,
   `columnResize = { mode: 'expand' }`.
3. `data-table.component.ts`:
   - `autoSizeStrategy`, `resizeEnabled`, `resizeMode` computeds.
   - `tableStyle` merges `minWidth` with the strategy's table width.
   - `columnLimits` computed: `ReadonlyMap<colId, { minWidth?, maxWidth? }>`. It throws on an
     unknown `colId`.
   - A `headerCellStyle(column)` helper returning `min-width`/`max-width` px strings.
4. Template: `[resizableColumns]`, `[columnResizeMode]`. On the **first** header row's `th`s only:
   `pResizableColumn`, `[pResizableColumnDisabled]="column.resizable === false"`,
   `[style.min-width.px]`, `[style.max-width.px]`. Put the `data-table--fit-contents` class on
   `<p-table>` for `fitCellContents`. Both `th` branches (sortable and non-sortable) get the same
   bindings.
5. SCSS: `.data-table--fit-contents` → `white-space: nowrap` on `th`/`td` (structural only). Bridge
   token for the resize indicator.

### Phase B — Specs
- **Status:** done
- **Started:** 2026-09-29 19:02
- **Ended:** 2026-09-29 19:08

happy-dom does not lay out, so assert the bindings, not the pixels:
- The default renders `p-datatable-resizable` + `-table` and no `-fit` class, and headers carry
  `p-datatable-resizable-column`.
- `columnResize: false` → no resizable classes. `resizable: false` → that `th` has no resizer
  element.
- `fitGridWidth` limits → `th` inline `min-width`/`max-width` in px. An unknown `colId` throws.
- `fitProvidedWidth` → `<table>` inline `width` in px. `fitCellContents` → `width: max-content` +
  the modifier class.
- `minWidth` still combines with every strategy.

### Phase C — Transactions opt-in and docs
- **Status:** done
- **Started:** 2026-09-29 19:02
- **Ended:** 2026-09-29 19:08

- `transactions.component.ts`: `autoSizeStrategy: { type: 'fitCellContents' }`. Keep
  `minWidth: '82rem'` as the floor. Update `transactions.component.spec.ts` if it asserts table
  styles.
- `docs/architecture.md` (package overview + Transactions table): mention the sizing strategy and
  resize.
- `transactions-table` skill: note the strategy.
- `angular-primeng-table` skill, "Verified PrimeNG 21 mechanics": add the resize mechanics and the
  px-only `min-width` parsing.

### Phase D — Browser verification
- **Status:** done
- **Started:** 2026-09-29 19:08
- **Ended:** 2026-09-29 19:40

Findings (Chrome, transactions page, 9,965 rows):
- **Filter row inflated every column to ~265px.** `p-columnFilter` renders `<input size="20">`
  (~200px on its own), so `fitCellContents` produced equal-width columns. Fixed in the component
  SCSS, under `.data-table--fit-contents`: the filter `th` gets `width: 0` and its input
  (`::ng-deep`) `width: 100%; min-width: 0`. Both halves are needed (each alone was tested and
  fails). Columns now follow their content (date 113px … purpose 1376px).
- **Expand resize works:** dragging +100px widens that column, the table and its filter cell by
  100px. The width survives paging, sorting and the global search. After a drag, PrimeNG pins every
  column, so widths also stop shifting between pages.
- **`min-width` on the header `th` is honoured** (400px test), so `minWidth`/`defaultMinWidth` and
  PrimeNG's resize floor work.
- **`max-width` is not.** Chrome ignores it on cells under auto layout, and an inner wrapper
  doesn't help either: a `width: 100%` table hands its spare width to columns in proportion to
  their content (the capped column still came out at 828px). A real cap needs
  `table-layout: fixed`, which turns off content sizing. **`maxWidth` was removed from
  `DataTableColumnLimit`** (user decision, 2026-09-29); `minWidth` is now required there.
- The resize indicator follows `--color-accent` in all five themes, in light and dark.
- The `left_click_drag` browser tool doesn't trigger PrimeNG's resize (no intermediate
  `mousemove`s); the drag was verified with dispatched mouse events.

`pnpm start:local`, then the transactions page. Check: widths fit the content, the table scrolls
horizontally, a drag in `expand` mode survives paging/sorting/filtering, the min-width floor is
respected, the filter row follows, and all five themes + dark mode show the resize indicator.
Separately check `fitGridWidth` with a `maxWidth` limit (temporarily) for the `max-width` risk.

### Phase E — Quality gates
- **Status:** done
- **Started:** 2026-09-29 19:40
- **Ended:** 2026-09-29 19:45

All green: format, lint, 110 frontend + 10 backend tests, build. The build's "initial bundle
exceeded budget" warning (630 kB vs 500 kB) was already there before this work (629.82 kB); this
feature adds ~0.1 kB.

`pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build` — all green, no
warnings.

## Out of scope

- ColDef `width`/`minWidth`/`maxWidth`/`flex` (not chosen).
- Persisting resized widths (PrimeNG `stateKey`) — a later feature if wanted.
- Keyboard-accessible resizing.
