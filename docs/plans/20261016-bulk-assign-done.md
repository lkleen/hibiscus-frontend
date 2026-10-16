# Bulk-assign a category to selected transactions — plan

Plan status: done

## Context

The row context menu already offers View, Edit and Assign for one transaction
(`docs/plans/20261016-assign-category-done.md`). The user wants to **select several rows and
assign them a category in one go**; while several rows are selected, View and Edit are disabled.

Decisions (confirmed with the user):
- **Checkbox column** in front of every row, a **header checkbox**, Ctrl/Cmd-click and Shift-click
  on top (ag-Grid's `rowSelection: { mode: 'multiRow', checkboxes, headerCheckbox }`).
- **Both tabs**: the list and the by-category tree (only transaction leaves are selectable).
- **All or nothing**: one request, one DB transaction; if any selected row changed elsewhere,
  nothing is saved (409) and the dialog says how many changed.

Decided here (ag-Grid defaults or least surprise):
- The header checkbox selects **all rows passing the current filters** (every page), tri-state.
  A selection is pruned to the rows that still pass the filters, so a bulk action never touches a
  row the user cannot see. A count ("12 selected" + Clear) shows in the table toolbar.
- Right-click on a row that is **part of** a multi-row selection → bulk menu (View/Edit disabled,
  Assign acts on the selection). Right-click on a row **outside** the selection → the usual
  single-row menu for that row; the selection is left alone.
- After a successful bulk assign the selection is cleared.
- Shift-click selects a range in the flat table's displayed order; in the tree it only toggles
  (range over a collapsible tree is ambiguous — YAGNI).
- Single-row Assign goes through the same bulk endpoint with one item (one code path); Edit keeps
  `PATCH /api/transactions/:id`.

## Pinned contracts

Shared (`packages/shared/src/contracts/transactions.d.ts`):
```ts
/** One row of a bulk category assignment: its id and the values the page has for it. */
export interface TransactionAssignItem {
  readonly id: number;
  readonly expected: TransactionEditableFields;
}
/** Body of `POST /api/transactions/assign-category`. `kommentar` is never changed. */
export interface TransactionAssignRequest {
  readonly items: readonly TransactionAssignItem[];
  readonly umsatztyp_id: number | null;
}
/** `409` body: the rows that no longer hold `expected` (or no longer exist). */
export interface TransactionAssignConflict {
  readonly error: 'conflict';
  readonly conflictIds: readonly number[];
}
```
Route `POST /api/transactions/assign-category` → `204`; `400` invalid body (1–10,000 items, unique
ids) or unknown category (FK); `409` `TransactionAssignConflict`.

Frontend:
- `ApiService.assignCategory(request: TransactionAssignRequest): Observable<void>`.
- `TransactionsStore.assignCategory(rows: readonly TransactionRow[], umsatztypId: number | null): Observable<void>`
  — builds `items` from the rows' current `kommentar`/`umsatztyp_id`; on `204` sets
  `row.umsatztyp_id` in place for every row and bumps `revision` once. Errors propagate.
- `<app-data-table>`:
  - `DataTableRowSelection = { mode: 'single' } | { mode: 'multiple'; isRowSelectable?: (row: Row) => boolean }`
    (generic over `Row`; `isRowSelectable` = ag-Grid's, default all rows).
  - `selectedRowIds = model<ReadonlySet<string | number>>(new Set())` for `'multiple'`
    (`selectedRowId` stays for `'single'`).
  - `DataTableContextMenuParams.selectedRows: readonly Row[]` — raw selected rows in display order
    (empty unless `'multiple'`).

## Phase A — Backend: bulk endpoint
- **Status:** done
- **Started:** 2026-10-16 16:05
- **Ended:** 2026-10-16 16:07

1. Shared contract types above.
2. `repositories/umsatz.ts`: `assignCategory(request): Promise<{ result: 'assigned' } | { result: 'conflict'; conflictIds: number[] }>`.
   One connection, `beginTransaction`; per item
   `UPDATE umsatz SET umsatztyp_id = ? WHERE id = ? AND kommentar <=> ? AND umsatztyp_id <=> ?`;
   collect ids with `affectedRows === 0` (FOUND_ROWS: see `updateTransaction`'s comment); any →
   `rollback` + conflict; else `commit`. Any error → `rollback`, rethrow; always release.
3. Zod schema in `transactions/transaction-update.ts` (items 1–10,000, ids unique, reuse the
   editable-fields schema for `expected`); route in `routes/transactions.ts` (FK → 400 like PATCH).
4. Specs: repository (statement shape, commit vs rollback, conflict ids, release on error) and
   route (204, 400s, 409 body).

## Phase B — `<app-data-table>`: multi-row selection
- **Status:** done
- **Started:** 2026-10-16 16:05
- **Ended:** 2026-10-16 16:12

Load `frontend-design:frontend-design`, `angular-primeng-table`, `frontend`, `frontend-angular`,
`frontend-theming`, `frontend-angular-cdk` first.

1. Model + `DEFAULT_TABLE_OPTIONS` untouched (off by default); `isRowSelectable` throws nothing —
   non-selectable rows simply have no checkbox.
2. A leading checkbox column (own `<th>`/filter `<th>`/`<td>`, not a `colDef`; not resizable or
   reorderable) in flat and tree mode. Native `<input type="checkbox">` with accessible labels
   ("Select row" / "Select all"), `accent-color` from a token. Header checkbox: checked when every
   selectable filtered row is selected, `indeterminate` when some are; toggles all selectable rows
   passing the current filters (column, quick and external filters; tree: every filtered
   selectable node, collapsed or not).
3. Ctrl/Cmd-click toggles a row; Shift-click selects the range from the last toggled row in the
   flat table's displayed (sorted, filtered) order; plain row click does nothing. Clicks on the
   checkbox, toggler, inputs and the resize handle are not row clicks.
4. Selected rows use the existing `--app-table-row-selected-bg` styling (both modes).
5. Pruning: whenever the filtered row set changes, ids not in it are removed (one `model` update).
   Guard against update loops.
6. `DataTableContextMenuParams.selectedRows` filled from the selection (raw rows, display order).
7. Specs: off by default (no checkbox column); flat: checkbox toggles, header select-all over
   all pages + indeterminate, Ctrl and Shift click, pruning on filter, `selectedRows` in menu
   params; tree: `isRowSelectable` hides checkboxes on non-selectable rows, header selects only
   selectable filtered leaves.

## Phase C — Store + API
- **Status:** done
- **Started:** 2026-10-16 16:05
- **Ended:** 2026-10-16 16:07

`ApiService.assignCategory` and `TransactionsStore.assignCategory` (pinned) + specs (body,
in-place mutation of every row, one revision bump, error leaves rows untouched).

## Phase D — Bulk assign UI on both tabs
- **Status:** done
- **Started:** 2026-10-16 16:12
- **Ended:** 2026-10-16 16:19

Load `frontend-design:frontend-design`, `frontend`, `frontend-angular`, `frontend-theming`,
`transactions-table` first.

1. **Assign dialog takes rows**: `TransactionDialogs.openAssign(rows: readonly TransactionRow[], onAssigned?: () => void)`;
   `TransactionDialogData` carries `rows`. Summary: one row as today; several → "N transactions".
   Current category: the shared path, or "Mixed categories" when they differ (no tree preselection
   then). "No category" disabled only when every row is already unassigned. Picking the category
   all rows already share does nothing; otherwise `store.assignCategory(rows, id)`. 409 → "N of
   the selected transactions were changed elsewhere. Reload the page to see the current values."
   (count from `conflictIds`; single row keeps the existing wording). Success calls `onAssigned`
   and closes.
2. **Menus** (`TransactionDialogs.menuItems`, both tabs): when `params.selectedRows` has more than
   one row and contains the clicked row → View and Edit `disabled: true`, Assign acts on the
   selection (tree: the selected rows' transactions) and its `onAssigned` clears the selection;
   otherwise the current single-row menu.
3. **Tabs**: list and by-category enable `rowSelection: { mode: 'multiple' }` (tree:
   `isRowSelectable: (row) => row.kind === 'transaction'`), hold the selection in a signal bound
   with `[(selectedRowIds)]`, and show "N selected" + a Clear button in the table toolbar while
   N > 0 (`[appDataTableToolbar]` slot, or the page toolbar via `DataTableToolbarOutlet` — follow
   how the tree's expand/collapse controls get there).
4. **i18n** (en/de): select row/all labels (generic `table.*`), "N selected", Clear, "N
   transactions", "Mixed categories", bulk conflict text.
5. **Specs**: dialog with several rows (mixed label, saves all, conflict count, single-row wording
   unchanged); menus disabled/enabled by selection on both tabs; selection cleared after success;
   toolbar count + Clear.

## Phase E — Docs
- **Status:** done
- **Started:** 2026-10-16 16:12
- **Ended:** 2026-10-16 16:12

`docs/architecture.md` (API table + write scope: the bulk route, all-or-nothing rule) and the
`transactions-table` skill (§1 write rule incl. the bulk route, §2 selection + menu, §3 selection
pruned to filtered rows).

## Phase F — Verification
- **Status:** done
- **Started:** 2026-10-16 16:19
- **Ended:** 2026-10-16 16:27

Quality gates from the repo root; browser check on both tabs (select via checkboxes, header,
Ctrl/Shift, bulk Assign, View/Edit disabled, conflict on one of several rows → nothing saved,
selection pruned by a filter, themes); restore every touched row afterwards.

Outcome: all gates green (65 backend, 399 frontend tests); pre-existing bundle-budget warning unchanged. Browser check passed all 10 checks (selection, header select-all across pages, Cmd/Shift click, no layout shift, bulk menu, bulk assign on both tabs, all-or-nothing conflict, pruning, themes); test rows restored. Follow-ups: express JSON limit raised to 10mb for the bulk route; disabled CDK menu items now styled via aria-disabled.

## Execution

| Step | Agent | Model / effort | Wave | Write set | Reads |
|------|-------|----------------|------|-----------|-------|
| A | implementer | sonnet / medium | 1 | shared `transactions.d.ts`, backend `repositories/umsatz*`, `routes/transactions*`, `transactions/transaction-update.ts` | this plan |
| B | implementer | sonnet / medium | 1 | `shared/components/data-table/**`, `src/styles/_primeng-table.scss` | this plan |
| C | implementer-light | haiku / low | 1 | `core/services/api.service*`, `features/transactions/transactions.store*` | this plan (pinned contract) |
| D | implementer | sonnet / medium | 2 | `features/transactions/{assign-dialog/,transaction-dialogs*,list/,by-category/transactions-by-category.component*}`, `i18n/{en,de}.json` | this plan |
| E | implementer-light | haiku / low | 2 | `docs/architecture.md`, `transactions-table` skill | this plan |
| F gates | main session | — | 3 | — | — |
| F browser | implementer | sonnet / low | 3 | — | this plan |
