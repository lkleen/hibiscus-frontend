**Status:** done

# Remove the category column from the transactions table

## Context

The user wants the category column gone from the transactions table. That column was the app's
only way to recategorize a transaction (category picker → `PATCH /api/transactions/:id`). Confirmed
scope: **remove everything incl. the backend** — transactions become read-only; the app's only
remaining write is per-user settings. `GET /api/transactions` keeps serving `umsatztyp_id` (the
API mirrors the DB one-to-one); the read-only categories page and `GET /api/categories` stay.

## Changes

### Backend + shared contract
- `packages/backend/src/routes/transactions.ts`: delete the `router.patch('/:id', …)` handler,
  `UpdateTransactionCategorySchema`, `TransactionIdParamsSchema` and now-unused imports
  (`z`, `respondWithValidationError`, `UpdateTransactionCategory`, `updateTransactionCategory`).
- `packages/backend/src/repositories/umsatz.ts` (+ `umsatz.spec.ts`): delete
  `updateTransactionCategory` and its tests.
- `packages/shared/src/contracts/transactions.d.ts`: delete `UpdateTransactionCategory`.

### Frontend
- `core/services/api.service.ts` (+ spec): delete `updateTransactionCategory`; keep `getCategories`
  (categories page uses it).
- `features/transactions/transactions.component.{ts,html}`: delete the `category_name` column,
  the `appDataTableCell="category"` template, `categories` signal + `getCategories()` call,
  `categoriesById`, `categoryUpdateErrorId`, `onCategoryChange`, `applyCategory`, the
  `dataTable` viewChild if then unused, and the `CategoryCellComponent` import; trim the class /
  column comments that describe recategorizing.
- `features/transactions/transactions.component.spec.ts`: `load()` no longer expects
  `/api/categories`; drop the `categories` option, the `COL.category` index and the
  category-update tests (~L364, ~L404); adjust the render test (~L119) to not assert a category.
- Delete `features/transactions/cells/category-cell/` and `features/transactions/category-picker/`.
- i18n `en.json` + `de.json`: delete `transactions.colCategory`, `transactions.categoryUpdateError`,
  `categoryPicker.uncategorized`, `categoryPicker.choose`.
- Keep `<app-data-table>`'s generic `refresh()` and `core/utils/category-color.ts` (categories
  page still uses it); keep `categoryRow` test fixture (categories spec uses it).

### Docs
- `docs/architecture.md`: write scope → per-user settings only; drop the `PATCH` row from the API
  table; transactions table paragraph: `umsatztyp_id` is served but not shown, remove the
  "category change … refresh()" sentence; categories page: "same `toCssColor` rendering as the
  category picker" → reword without the picker.
- `.claude/skills/transactions-table/SKILL.md`: update write scope (L34–35), the
  `umsatztyp_id` → picker mapping (L45), the category `valueGetter` mention (L73–74) and the
  category-change/refresh rule (L91–92).
- Persist this plan as `docs/plans/20261004-remove-category-column-<status>.md`.

## Phases

### Phase A — backend + contract
- **Status:** done
- **Started:** 2026-10-04 19:29
- **Ended:** 2026-10-04 19:31

### Phase B — frontend
- **Status:** done
- **Started:** 2026-10-04 19:29
- **Ended:** 2026-10-04 19:31

### Phase C — docs
- **Status:** done
- **Started:** 2026-10-04 19:29
- **Ended:** 2026-10-04 19:31

## Execution

| Step | Agent | Model/effort | Wave | Write set | Reads |
|---|---|---|---|---|---|
| Backend + contract | implementer-light | haiku / low | 1 | backend route, umsatz repo + spec, `transactions.d.ts` | same |
| Frontend code, specs, i18n, deletions | implementer-light | sonnet / low | 1 | api.service(+spec), transactions.component.*, cells/category-cell, category-picker, i18n | same |
| Docs + plan file | main | — | 1 | architecture.md, SKILL.md, docs/plans | — |

Write sets are disjoint; the frontend step only removes uses of the contract type the backend step
deletes, so both run in parallel.

## Verification
- `grep -rn "updateTransactionCategory\|UpdateTransactionCategory\|category-picker\|categoryPicker\|colCategory"`
  over `packages/` → no hits.
- `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build` from repo root.
- `pnpm start:local` → transactions page has no category column and makes no `/api/categories`
  request; categories page still renders with colours.
