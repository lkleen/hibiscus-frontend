# Row context menu for `<app-data-table>` — plan

Plan status: done

## Context

The user wants a generic context menu for tables with an API modelled on ag-Grid's
(`getContextMenuItems(params)` returning `MenuItemDef | string` entries, built-ins as strings,
`'separator'`). The transactions list gets one entry, **Show**, which opens an overlay listing all
details of the right-clicked row. Per CLAUDE.md, the feature lives in `<app-data-table>`
(switchable, off by default); features only configure it.

Decisions (confirmed with the user):
- The details overlay lists **every table column** (visible columns, current order, header label +
  cell content exactly as the table renders it, incl. columns scrolled out of view). The five
  matching-only fields (`kommentar`, …) stay hidden, as the `transactions-table` skill requires.
- Only the transactions **list** tab wires the menu now; the tree mode supports it generically.

Building blocks already in the repo / deps:
- `@angular/cdk/menu` (`CdkMenu`, `CdkMenuItem`, used in `core/components/user-menu/`) — it also
  ships `CdkContextMenuTrigger` (opens at pointer coords, owns focus, keyboard nav, Escape /
  outside-click dismissal, ARIA roles, and leaves the native menu alone when disabled).
- `@angular/cdk/dialog` (`Dialog`, `DIALOG_DATA`, `DialogRef`) for the details overlay — no new lib.
- `#cellContent` template in `data-table.component.html` (renderer or formatted value) — reused
  inside the dialog so values look exactly like in the table (e.g. the amount cell renderer).
- `cellView(column, row).raw` in `data-table.component.ts` gives the raw row behind the
  column-accessor proxy.

## API (data-table.model.ts)

```ts
/** ag-Grid's `GetContextMenuItemsParams`. */
export interface DataTableContextMenuParams<Row> {
  readonly row: Row;                                  // raw row
  readonly column: DataTableVisibleColDef<Row, unknown>; // the right-clicked cell's column
  readonly value: unknown;                            // that column's valueGetter result
}
/** ag-Grid's `MenuItemDef`; `action` closes over the params like in ag-Grid. */
export interface DataTableMenuItemDef {
  readonly nameKey: TranslationKey;
  readonly action: () => void;
  readonly disabled?: boolean;
}
/** Built-ins as strings, like ag-Grid's `'copy'`/`'separator'`. `'showDetails'` opens the
 *  row-details dialog (every visible column, label + rendered cell). */
export type DataTableMenuItem = DataTableMenuItemDef | 'separator' | 'showDetails';

// DataTableOptionsBase<Row>:
/** ag-Grid's `getContextMenuItems`. Unset (default): no custom menu, the browser's own one shows. */
readonly getContextMenuItems?: (params: DataTableContextMenuParams<Row>) => readonly DataTableMenuItem[];
```

## Phase A — Context menu + details dialog in `<app-data-table>`
- **Status:** done
- **Started:** 2026-10-16 14:09
- **Ended:** 2026-10-16 14:16

Invoke `frontend-design:frontend-design` first; follow `frontend`, `frontend-angular`,
`frontend-angular-cdk`, `frontend-theming`, `angular-primeng-table` skills.

1. `data-table.model.ts` — the types above + option doc comment.
2. `data-table.component.ts`:
   - `contextMenuEnabled = computed(() => options().getContextMenuItems !== undefined)`.
   - `contextTarget = signal<{ column; row: Row } | null>` set by `onCellContextMenu(column, boundRow)`
     (raw row via `cellView`). The `<td>` handler runs before the `<tr>`'s CDK trigger (event
     bubbling), so the menu always reads the cell that was clicked.
   - `contextMenuItems = computed(...)`: calls `getContextMenuItems({ row, column, value })`, maps
     `'showDetails'` to `{ nameKey: 'table.menuShowDetails', action: () => openRowDetails(row) }`;
     throws if called without a target (no defensive return).
   - `openRowDetails(row)`: `Dialog.open(DataTableRowDetailsComponent, { data, ariaLabelledBy… })`
     with `data = { cellContent: TemplateRef, columns: visibleColumns(), row }`. Keep the
     `DialogRef` and close it on `DestroyRef.onDestroy` (the dialog renders this component's
     template — it must not outlive it, e.g. on tab switch).
3. `data-table.component.html` — in both bodies (flat and tree): `<td (contextmenu)="onCellContextMenu(column, row)">`
   and on the `<tr>`: `[cdkContextMenuTriggerFor]="rowMenu" [cdkContextMenuDisabled]="!contextMenuEnabled()"`.
   New `<ng-template #rowMenu>`: `<div cdkMenu class="data-table-menu">` iterating
   `contextMenuItems()` — `'separator'` → `<hr role="separator">`, else
   `<button cdkMenuItem [cdkMenuItemDisabled]=… (cdkMenuItemTriggered)="item.action()">`.
4. New `shared/components/data-table/row-details-dialog/` (`.ts/.html/.scss`, OnPush):
   `DIALOG_DATA` typed by an exported `DataTableRowDetailsData<Row>` interface; renders a `<dl>`
   (header label → `ngTemplateOutlet` of `cellContent` with `{ column, row }`), a title
   (`table.rowDetailsTitle`) and a close button (`table.close`, `DialogRef.close()`); Escape/backdrop
   close and focus trap come from CDK Dialog. Mobile-first: full-width sheet on narrow screens,
   capped width and scrollable body on wide ones. Styling only via theme tokens (surface, text,
   depth, scrim, motion with reduced-motion); menu panel styled like `user-menu`'s panel (tokens,
   not copied values). Confirm CDK overlay base CSS is already loaded (user-menu needs it too).
5. i18n `packages/frontend/src/i18n/{en,de}.json`: `table.menuShowDetails` ("Show"/"Anzeigen"),
   `table.rowDetailsTitle` ("Details"/"Details"), `table.close` ("Close"/"Schließen") — reuse
   existing keys if equivalents exist.
6. `data-table.component.spec.ts` (follow existing option tests) + a spec for the dialog:
   - no `getContextMenuItems` → `contextmenu` event on a cell is not `defaultPrevented`, no menu;
   - with items → menu opens with translated names, separator rendered, `params.row` is the raw
     row and `params.column.colId` the clicked cell's column; custom `action` called on click;
   - `'showDetails'` → dialog lists every visible column's header and rendered value (incl. a
     `cellRenderer` column), closes on the close button;
   - tree mode: menu opens on a tree row too.

Race-condition check: `contextTarget` is written and read synchronously within one `contextmenu`
dispatch; a second right-click replaces both target and menu (CDK closes the previous one). The
dialog is closed when the table is destroyed.

## Phase B — Wire "Show" into the transactions list
- **Status:** done
- **Started:** 2026-10-16 14:16
- **Ended:** 2026-10-16 14:18

1. `features/transactions/transactions.store.ts` — `listOptions.getContextMenuItems: () => ['showDetails']`.
2. `features/transactions/list/transactions-list.component.spec.ts` — right-click a row → "Show"
   item → dialog lists the transaction's columns (e.g. purpose and account holder).
3. `.claude/skills/transactions-table/SKILL.md` — one line: the list tab's row context menu
   "Show" opens a details dialog with every displayed column (same display rules).

## Phase C — Verification
- **Status:** done
- **Started:** 2026-10-16 14:18
- **Ended:** 2026-10-16 14:22

- Quality gates from repo root: `pnpm format:fix`, `pnpm format:check`, `pnpm lint`, `pnpm test`,
  `pnpm build` — all clean (pre-existing bundle-budget warning excepted, as in the row-hover plan).
- Browser (dev server, Claude in Chrome), if a DB is available: right-click a transaction → menu at
  pointer → "Show" → dialog with all columns; Escape/backdrop/close button; keyboard navigation in
  the menu; themes `default` light/dark and `greenbar`; narrow viewport. By-category tab still shows
  the native context menu.

Outcome: all gates green (331 frontend tests); pre-existing initial-bundle budget warning unchanged. Browser check passed (menu, dialog, themes, 390px width, by-category keeps the native menu); focus returns to `body` after closing, since table cells are not focusable. Console check inconclusive.

## Execution

| Step | Agent | Model / effort | Wave | Write set | Reads |
|------|-------|----------------|------|-----------|-------|
| A1–A6 | implementer | sonnet / medium | 1 | `shared/components/data-table/**`, `i18n/{en,de}.json` | this plan, user-menu component |
| B1–B3 | implementer-light | haiku / low | 2 | `transactions.store.ts`, `transactions-list.component.spec.ts`, `transactions-table` skill | this plan, A's model types |
| C gates | main session | — | 3 | — | — |
| C browser | implementer | sonnet / low | 3 | — | this plan |
