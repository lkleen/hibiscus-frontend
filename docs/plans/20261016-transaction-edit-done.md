# Edit a transaction's comment and category — plan

Plan status: done

## Context

The row context menu of both transactions tabs has one entry, "Show". The user wants it renamed to
**View** and a second entry, **Edit**, which lets them change a transaction's comment
(`umsatz.kommentar`) and category (`umsatz.umsatztyp_id`, which may also be unset). The category is
picked from a **tree**.

Decisions (confirmed with the user):
- **Stale saves are rejected.** The save carries the values the dialog started from; the backend
  updates only if the row still has them (one atomic `UPDATE … WHERE`), otherwise `409`. Covers edits
  made meanwhile in the Hibiscus desktop client or another browser tab.
- **The picker is `<app-data-table>` in tree mode** with a new single-row selection option
  (switchable, off by default) — per CLAUDE.md every table is `<app-data-table>`.
- **Edit on both tabs**: list rows and the by-category tree's transaction rows (like "View").

This widens the write scope: today `umsatz` is read-only (`docs/architecture.md` "Write scope",
`transactions-table` skill §1). `kommentar` and `umsatztyp_id` are user fields in Hibiscus (not
bank-imported); bank-imported fields stay read-only. Both docs change accordingly.

Verified facts:
- `umsatz.kommentar` is `TEXT NULL`; `umsatztyp_id` is `INT NULL` with
  `fk_umsatz_umsatztyp → umsatztyp(id)` — the DB itself rejects an unknown category id.
- Backend: Express routers under `requireAuth` (`packages/backend/src/server.ts`), JSON body
  parsing on, zod validation + `respondWithValidationError` (`routes/zod-validation.ts`), pattern in
  `routes/settings.ts` / `settings.spec.ts` (repository mocked via `vi.mock`).
- Frontend: `TransactionsStore` holds `transactions` (signal); `categoryAssignment` and
  `filteredTransactions` derive from it. The `transactions-table` skill: to change a row, **mutate
  the raw row and call `dataTable().refresh()`** — replacing the row or array resets PrimeNG's page.
- Menu API in `shared/components/data-table/data-table.model.ts`: custom
  `DataTableMenuItemDef { nameKey, action }`, built-in `'showDetails'`, `showDetailsOf()`.
  The by-category tab uses `showDetailsOf(store.transactionColumns, row.transaction)`.
- Categories: `CategoryRow` (`id`, `name`, `parent_id`, `color`/`customcolor`, …),
  `toCssColor()` (`core/utils/category-color.ts`), `categoryPaths()` (`core/utils/category-path.ts`).

## Pinned contracts

Shared (`packages/shared/src/contracts/transactions.d.ts`):
```ts
/** The `umsatz` fields this app may change; everything else is bank-imported and read-only. */
export type TransactionEditableFields = Pick<TransactionRow, 'kommentar' | 'umsatztyp_id'>;
/** Body of `PATCH /api/transactions/:id`. `expected`: the values the edit started from. */
export interface TransactionUpdateRequest {
  readonly expected: TransactionEditableFields;
  readonly next: TransactionEditableFields;
}
```
Route: `PATCH /api/transactions/:id` → `204`; `400` invalid body/id or unknown category (FK error
`ER_NO_REFERENCED_ROW_2`); `404` no such transaction; `409` the row no longer has `expected`.

Frontend:
- `ApiService.updateTransaction(id: number, request: TransactionUpdateRequest): Observable<void>`.
- `TransactionsStore.saveTransaction(row: TransactionRow, next: TransactionEditableFields): Observable<void>`
  — sends `{ expected: { kommentar: row.kommentar, umsatztyp_id: row.umsatztyp_id }, next }`; on
  success mutates `row.kommentar`/`row.umsatztyp_id` in place and bumps
  `readonly revision = signal(0)`. Errors propagate (no catch).
- `DataTableOptionsBase.rowSelection?: { readonly mode: 'single' }` plus component two-way input
  `selectedRowId = model<string | number | null>(null)` (ids from `getRowId`).

## Phase A — Backend: `PATCH /api/transactions/:id`
- **Status:** done
- **Started:** 2026-10-16 14:53
- **Ended:** 2026-10-16 14:55

1. Shared contract types above.
2. `packages/backend/src/repositories/umsatz.ts`: `updateTransaction(id, request): Promise<'updated' | 'not-found' | 'conflict'>`.
   One statement: `UPDATE umsatz SET kommentar = ?, umsatztyp_id = ? WHERE id = ? AND kommentar <=> ? AND umsatztyp_id <=> ?`.
   `affectedRows === 1` → `'updated'`; else `SELECT 1 FROM umsatz WHERE id = ?` → `'not-found'` /
   `'conflict'`. (MariaDB counts *matched* rows only with `CLIENT_FOUND_ROWS`; check the pool's
   flags so an update to identical values isn't misread as a conflict — `expected === next` must
   return `'updated'`.)
3. `routes/transactions.ts`: zod schema `TransactionUpdateSchema` (in a new
   `packages/backend/src/transactions/transaction-update.ts`, like `settings/table-density.ts`;
   `kommentar: string | null`, `umsatztyp_id: positive int | null`, typed against the shared
   contract), `:id` positive int, map results to `204/404/409`, FK error → `400`.
4. Specs: `repositories/umsatz.spec.ts` (SQL shape, parameter order, the three results) and a new
   `routes/transactions.spec.ts` following `settings.spec.ts` (400 body/id, 204, 404, 409, FK 400).

## Phase B — `<app-data-table>`: single-row selection + shared dialog styles
- **Status:** done
- **Started:** 2026-10-16 14:53
- **Ended:** 2026-10-16 14:58

Invoke `frontend-design:frontend-design` first; follow `angular-primeng-table`, `frontend`,
`frontend-angular`, `frontend-theming`.

1. `data-table.model.ts`: `rowSelection?: { readonly mode: 'single' }` (ag-Grid's
   `rowSelection: { mode: 'singleRow' }`), default off (`DEFAULT_TABLE_OPTIONS` in
   `data-table.defaults.ts`).
2. `data-table.component.ts/.html`: `selectedRowId = model<string | number | null>(null)`.
   Flat: `selectionMode="single"`, `[selection]`/`(selectionChange)` mapped through `getRowId`,
   `[pSelectableRow]` on body rows. Tree: same with `ttSelectableRow` and the `TreeNode` whose
   `data` has that id. Clicking the selected row again keeps it selected (no PrimeNG meta-key
   toggle-off: `[metaKeySelection]="false"`, and ignore a `null` from re-click). Keyboard: Enter/Space
   on a focused row selects (PrimeNG's selectable rows are focusable). Selected row styled via the
   theme bridge in `src/styles/_primeng-table.scss` (`--app-table-row-selected-bg` from existing
   tokens, both light/dark).
3. Extract the details dialog's panel/backdrop styles from `row-details-dialog.component.scss` into
   a global partial `packages/frontend/src/styles/_dialog.scss` (`.app-dialog-panel`,
   `.app-dialog-backdrop`, header/footer/close-button blocks) so the edit dialog reuses them; the
   details dialog keeps only its list styles. Exported constants for the class names live with the
   partial's TS counterpart (e.g. `shared/dialog/dialog-classes.ts`).
4. Specs in `data-table.component.spec.ts`: selection off by default (no selectable rows); flat and
   tree: initial `selectedRowId` highlights the row, click sets it, re-click keeps it.

## Phase C — Store + API
- **Status:** done
- **Started:** 2026-10-16 14:55
- **Ended:** 2026-10-16 15:00

1. `ApiService.updateTransaction` (pinned) + spec in its existing spec file (method, URL, body).
2. `TransactionsStore.saveTransaction` + `revision` (pinned). `filteredTransactions` and
   `categoryAssignment` read `revision()` so the by-category tab regroups; `rowFilter` does **not**
   (a new predicate would reset the list's page — the list refreshes instead, Phase D).
3. Specs in `transactions.store.spec.ts`: request body, in-place mutation, revision bump,
   `categoryAssignment` recomputed, error leaves the row untouched.

## Phase D — Edit dialog and menu wiring
- **Status:** done
- **Started:** 2026-10-16 15:00
- **Ended:** 2026-10-16 15:07

Invoke `frontend-design:frontend-design` first; follow `frontend`, `frontend-angular`,
`frontend-angular-cdk`, `frontend-theming`, `transactions-table`.

1. New `features/transactions/edit-dialog/transaction-edit-dialog.component.{ts,html,scss,spec.ts}`
   (CDK Dialog, global dialog classes from Phase B):
   - Title "Edit transaction", a short read-only summary (value date, amount, recipient/purpose 1).
   - **Comment**: `<textarea>` bound to a signal; an empty textarea saves `null`.
   - **Category**: the current choice as its path (`categoryPaths`) or "No category", a
     "No category" button that unsets it, and `<app-data-table>` tree over `store.categories()`
     (`rowSelection: { mode: 'single' }`, `[(selectedRowId)]`, quick filter on, all expanded, name
     column with the colour swatch like the by-category tab, `scrollHeight` bounded).
   - Save / Cancel. Save disabled while saving and when nothing changed. On `409`: an inline error
     "This transaction was changed elsewhere. Reload the page to see the current values." and Save
     stays disabled; other errors: generic inline error, the dialog stays open. Success closes it.
   - Opened via a small `TransactionEditDialog` service provided in the shell
     (`transactions.component.ts` providers) with `open(row: TransactionRow): void`; it closes an
     open edit dialog first and on shell destroy.
2. Menus: list (`store.listOptions`) → `['showDetails', { nameKey: 'transactions.menuEdit', action: () => edit.open(row) }]`;
   by-category transaction rows → `[showDetailsOf(…), { …Edit… }]`. Because `listOptions` lives in
   the store but needs the dialog service, move `getContextMenuItems` for the list into
   `TransactionsListComponent` (spread `store.listOptions`) rather than injecting UI into the store.
3. List repaint: `TransactionsListComponent` runs `effect(() => { store.revision(); untracked(() => table().refresh()); })`
   (skip the initial run), keeping the page and filters.
4. i18n (en/de): rename `table.menuShowDetails` "Show" → `table.menuView` "View"/"Anzeigen";
   `transactions.menuEdit` "Edit"/"Bearbeiten", dialog title, labels, "No category"/"Keine
   Kategorie", Save/Cancel, conflict + generic error. Update specs that click "Show".
5. Specs: dialog (prefill, unset category, pick in tree, empty comment → null, 409 message, success
   closes and list cell shows the new comment/category path); list + by-category menus show
   "View", "Edit".

## Phase E — Docs
- **Status:** done
- **Started:** 2026-10-16 15:00
- **Ended:** 2026-10-16 15:01

- `docs/architecture.md`: write scope now includes `umsatz.kommentar`/`umsatztyp_id` via
  `PATCH /api/transactions/:id` with the stale-save rule; API section.
- `.claude/skills/transactions-table/SKILL.md` §1: "read-only" → only `kommentar` and
  `umsatztyp_id` are editable (the conflict rule, in-place mutation + `refresh()`); bank-imported
  fields are never edited. §2: "View"/"Edit" menu wording.

## Phase F — Verification
- **Status:** done
- **Started:** 2026-10-16 15:07
- **Ended:** 2026-10-16 15:13

- Quality gates from repo root: `pnpm format:fix`, `pnpm format:check`, `pnpm lint`, `pnpm test`,
  `pnpm build` (pre-existing bundle-budget warning excepted).
- Browser (dev server + local DB): edit a comment and a category on the list and on the
  by-category tab; unset a category; check the list keeps its page; tree regroups; a conflict
  (change the row in the DB via `mariadb` between open and save) shows the 409 message; themes
  default light/dark + greenbar; 390px width. Restore the edited rows' original values afterwards.

Race-condition check: the stale-save `WHERE` makes concurrent writers safe without locks; the store
mutates only after a confirmed `204`; one edit dialog at a time; the dialog closes with the shell.

Outcome: all gates green (51 backend, 357 frontend tests); pre-existing bundle-budget warning unchanged. Browser check passed: edit + save, unset, page kept, 409 message, by-category regroup, keyboard, themes, 390px; test rows restored. Follow-up: the error message moved into the footer (it was below the tree, off-screen on short viewports). Open: selected tree row is low-contrast in default light and greenbar; on a 713px-high window the tree is ~100px tall.

## Execution

| Step | Agent | Model / effort | Wave | Write set | Reads |
|------|-------|----------------|------|-----------|-------|
| A | implementer | sonnet / medium | 1 | `packages/shared/src/contracts/transactions.d.ts`, `packages/backend/src/{repositories/umsatz*,routes/transactions*,transactions/}` | this plan, `routes/settings*.ts` |
| B | implementer | sonnet / medium | 1 | `shared/components/data-table/**`, `src/styles/_dialog.scss`, `src/styles/_primeng-table.scss`, `styles.scss` import, `shared/dialog/` | this plan |
| C | implementer-light | haiku / low | 2 | `core/services/api.service*.ts`, `features/transactions/transactions.store*.ts` | this plan, Phase A contract |
| D | implementer | sonnet / medium | 3 | `features/transactions/{edit-dialog/,list/,by-category/transactions-by-category.component*,transactions.component.ts}`, `i18n/{en,de}.json`, data-table spec text "Show" | this plan |
| E | implementer-light | haiku / low | 3 | `docs/architecture.md`, `transactions-table` skill | this plan |
| F gates | main session | — | 4 | — | — |
| F browser | implementer | sonnet / low | 4 | — | this plan |
