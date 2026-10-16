# Assign a transaction to a category from the context menu — plan

Plan status: done

## Context

The row context menu of both transactions tabs has "View" and "Edit". The user wants a third entry,
**Assign**, with a tooltip explaining that it assigns a transaction to a category or removes its
category directly. It opens a category tree with search; picking a category assigns it at once.

Builds on the edit feature (`docs/plans/20261016-transaction-edit-done.md`):
- `TransactionsStore.saveTransaction(row, next)` — stale-save rule (409), in-place mutation,
  `revision` bump; list refresh and by-category regroup already react to it.
- `features/transactions/edit-dialog/`: `TransactionEditDialog` service (one dialog at a time,
  closes with the shell, store passed via `DIALOG_DATA` — not the shell injector, see its comment)
  and `TransactionEditDialogComponent`, whose category tree (`<app-data-table>` tree,
  `rowSelection: { mode: 'single' }`, `[(selectedRowId)]`, swatch renderer, quick filter) is the
  picker to reuse.
- Shared dialog styles `src/styles/_dialog.scss` / `shared/dialog/dialog-classes.ts`; error
  messages sit in the footer (`.transaction-edit__error`, uncommitted fix in the working tree —
  keep it).
- Menu API: `DataTableMenuItemDef { nameKey, action, disabled? }`
  (`shared/components/data-table/data-table.model.ts`), rendered in `data-table.component.html`
  `#rowMenu`.

## Phase A — Implementation
- **Status:** done
- **Started:** 2026-10-16 15:40
- **Ended:** 2026-10-16 15:22

1. **Menu tooltip** (generic): `DataTableMenuItemDef.tooltipKey?: TranslationKey` → the menu button
   gets `[title]` and `[attr.aria-description]` with the translation. Spec in
   `data-table.component.spec.ts`.
2. **Category picker** extracted to `features/transactions/category-picker/category-picker.component.*`:
   input `categories: readonly CategoryRow[]`, two-way `selectedId = model<number | null>()`,
   output only on a user pick; the tree, swatch renderer, quick filter and options move here from
   the edit dialog, which then uses `<app-category-picker>`. Behaviour of the edit dialog unchanged.
3. **Assign dialog** `features/transactions/assign-dialog/transaction-assign-dialog.component.*`
   (shared dialog classes): title "Assign category", one-line summary (value date, amount,
   recipient), current category path or "No category", a "No category" button (unassigns; disabled
   when already unassigned), the picker. Picking a category different from the current one saves
   at once via `saveTransaction(row, { kommentar: row.kommentar, umsatztyp_id: id })` (comment
   untouched) and closes on success; picking the current one does nothing. While saving: picker and
   buttons disabled, `disableClose`. 409 → footer message "changed elsewhere", no further saves;
   other errors → generic footer message, the user may pick again. Cancel closes. Focus lands on
   the picker's search field. Same race guards as the edit dialog (re-entry, destroyed while saving).
4. **One service for both dialogs**: rename `TransactionEditDialog` to `TransactionDialogs`
   (`features/transactions/transaction-dialogs.ts`) with `openEdit(row)` and `openAssign(row)`;
   still one dialog at a time. Update the shell providers and specs.
5. **Menus**: both tabs show View, Edit, Assign (with `tooltipKey`). Build the Edit/Assign pair once
   (a small helper next to the service) instead of repeating it in the list and by-category
   components.
6. **i18n** (en/de): `transactions.menuAssign` "Assign"/"Zuordnen";
   `transactions.menuAssignTooltip` "Assign this transaction to a category, or remove its category"
   / "Diese Buchung einer Kategorie zuordnen oder die Zuordnung entfernen";
   `transactions.assign.title` "Assign category"/"Kategorie zuordnen"; reuse the edit dialog's
   "No category", conflict, error and cancel keys where the wording fits.
7. **Specs**: picker (pick emits, initial selection); assign dialog (pick saves with the comment
   unchanged and closes, picking the current category does nothing, "No category" unassigns, 409
   message blocks further picks, generic error allows retry); menus on both tabs list
   View/Edit/Assign and Assign has its tooltip; edit dialog specs still green.
8. **Docs**: `transactions-table` skill §2 context-menu bullet and `docs/architecture.md`'s
   transactions page section mention Assign.

## Phase B — Verification
- **Status:** done
- **Started:** 2026-10-16 15:22
- **Ended:** 2026-10-16 15:27

- Quality gates from repo root (`pnpm format:fix`, `format:check`, `lint`, `test`, `build`).
- Browser: Assign on both tabs (tooltip visible on hover), search + pick saves and the Category
  cell / tree updates, "No category" unassigns, keyboard pick (Enter/Space), 409 path; restore the
  test rows' original values afterwards.

Outcome: all gates green (51 backend, 371 frontend tests); pre-existing bundle-budget warning unchanged. Browser check passed all 9 checks; test rows restored. Note: clicking a tree row within the search debounce can hit the row under the pointer before the filtered list repaints.

## Execution

| Step | Agent | Model / effort | Wave | Write set | Reads |
|------|-------|----------------|------|-----------|-------|
| A1–A8 | implementer | sonnet / medium | 1 | `shared/components/data-table/data-table.{model.ts,component.html,component.spec.ts}`, `features/transactions/{category-picker/,assign-dialog/,edit-dialog/,transaction-dialogs*.ts,list/,by-category/transactions-by-category.component*,transactions.component*}`, `i18n/{en,de}.json`, skill, `docs/architecture.md` | this plan |
| B gates | main session | — | 2 | — | — |
| B browser | implementer | sonnet / low | 2 | — | this plan |
