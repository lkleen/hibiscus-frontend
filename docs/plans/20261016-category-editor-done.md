# Category editor overlay with live match preview

**Plan status:** done

## Context

Categories (`umsatztyp`) are read-only today (`GET /api/categories`, read-only `/categories` page;
architecture.md: "Category editing is planned as a later step"). The user wants to create and edit
categories in a CDK dialog like the transaction Edit/Assign dialogs, with a transactions table
inside it that live-updates which transactions the edited pattern/regex matches. Nothing is saved
until the user confirms with **Create** (new) / **Apply** (edit).

Decisions from the user:

- **Preview** = every transaction the draft's pattern + type + account scope matches, plus a
  **status** column: _assigned here_ / _stored as ‹other category›_ / _claimed first by ‹earlier
  category›_.
- **Entry points are context menus only:**
  - Transaction row (list tab and by-category transaction leaves): new entry **Create category** →
    create dialog prefilled to match that transaction.
  - Category row (categories page tree, and by-category category nodes except "Unassigned"): only
    **Edit**.
  - No toolbar "New" button, no delete.

## Design

### Shared contract — `packages/shared/src/contracts/categories.d.ts`

- `CategoryEditableFields = Omit<CategoryRow, 'id'>` (derived, not restated — SPOT).
- `CategoryCreateRequest = CategoryEditableFields` → `201` with the created `CategoryRow`.
- `CategoryUpdateRequest { expected: CategoryEditableFields; next: CategoryEditableFields }`
  (same optimistic-concurrency shape as `TransactionUpdateRequest`).

### Backend

- `repositories/umsatztyp.ts`: `createCategory(fields)` (`INSERT`, then `SELECT` the row by
  `insertId`, returned as stored) and `updateCategory(id, request)` →
  `'updated' | 'not-found' | 'conflict' | 'cycle'`: one DB transaction, `SELECT id, parent_id FROM
umsatztyp FOR UPDATE`, reject when `next.parent_id` is the row itself or one of its descendants,
  then `UPDATE … SET <all editable cols> WHERE id = ? AND <each col> <=> ?` (affectedRows 0 →
  re-check existence → 404 vs 409). Column list derived from `CATEGORY_COLUMNS` minus `id`.
- New `packages/backend/src/categories/category-update.ts` with zod schemas (pattern of
  `transactions/transaction-update.ts`): `name` non-empty trimmed ≤255, `nummer` ≤5, `pattern` ≤255,
  `color` matches `r,g,b` (0–255) or null, `isregex`/`customcolor` 0|1|null, `umsatztyp`
  0|1|2|null, `parent_id`/`konto_id` positive int|null, `konto_kategorie` ≤255, `kommentar` ≤16,383,
  `flags` int ≥0|null; `.strict()`. **First step of Phase A:** confirm lengths/nullability against
  the local DB (`SHOW CREATE TABLE umsatztyp`) and adjust.
- `routes/categories.ts`: `POST /` (201 + row), `PUT /:id` (204 / 400 invalid or unknown parent/
  account via `ER_NO_REFERENCED_ROW_2` / 400 `cycle` / 404 / 409). Reuse `respondWithValidationError`.
- Specs next to `umsatztyp.spec.ts` / `transactions.spec.ts` patterns.

### Frontend — matching logic moves to core

- Move `features/transactions/by-category/category-assignment.ts` → `core/utils/category-matching.ts`
  (+ spec). Keep `assignCategories()` unchanged and export the building blocks the preview needs:
  `compileCategory(category) → CompiledCategory | { invalid: true }` and
  `matchesCategory(compiled, transaction, account): boolean` (type + account + pattern). The
  assignment loop is rewritten on top of them, so there is one matcher. Update imports in
  `TransactionsStore`, `category-report.ts`.
- `core/utils/category-color.ts`: add `toStoredColor(hex) → "r,g,b"` and `toHexColor(row)` (for
  `<input type="color">`), with specs. Writes always use Hibiscus's `r,g,b` format.
- `ApiService`: `createCategory(request): Observable<CategoryRow>`, `updateCategory(id, request)`.

### Frontend — the dialog (`features/categories/edit-dialog/`)

`CategoryEditDialogComponent` + `CategoryDialogs` opener service (mirrors `TransactionDialogs`:
one open dialog, closed on destroy, `APP_DIALOG_*` classes). Imported by the transactions feature.

- **Data** (`category-edit-dialog.model.ts`): `{ mode: 'create' | 'edit'; initial:
CategoryEditableFields; category?: CategoryRow; source: CategoryEditSource }`, where
  `CategoryEditSource` exposes signals `categories`, `transactions`, `accountsById`,
  `categoryPathsById`, and `saveCategory(...)` returning `Observable<CategoryRow>`. Implemented by
  `TransactionsStore` and by a new `CategoriesStore` for the categories page (passed through
  `DIALOG_DATA`, like the transaction dialogs).
- **Form** (signals, no forms lib): name, parent (reuse `<app-category-picker>`, self + descendants
  excluded in edit mode, "No parent" button like "No category"), pattern + "regular expression"
  checkbox, type (any/expense/income), account (select of accounts, "any"), account category,
  number, colour (checkbox "custom colour" + `<input type="color">`), comment, "skip in reports"
  (flags bit 1; other bits preserved).
- **Live preview**: `draft` = computed from the form; `previewDraft` = draft debounced 300 ms
  (same idea as `TransactionsStore.debouncedSearch`). `preview` computed:
  1. compile the draft; an invalid regex → inline error under the pattern field, empty preview,
     Create/Apply disabled; an empty pattern → hint "no pattern, matches nothing automatically".
  2. hits = all transactions with `matchesCategory(draft)` (accounts resolved via `accountsById`).
  3. status: run `assignCategories` over **hits only** with the categories list where the edited
     category is replaced by the draft (create: draft appended with a sentinel id) →
     stored id ≠ null → _stored as X_ (or _stored here_); assigned === draft → _assigned here_;
     else _claimed by X_.
  - Rendered by `<app-data-table>` (no table code in the feature): columns status, valuta, betrag
    (amount cell), empfaenger_name, zweck, account label, stored category path; quick filter on,
    sorted by valuta desc; count "N matching · M assigned here" above it.
- **Layout**: wide panel (`--app-dialog-width` override, e.g. 72rem) — form left, preview right
  on wide screens; stacked on mobile (mobile-first, container-driven per `frontend` skill).
  Invoke `frontend-design:frontend-design` before building it (memory rule).
- **Save**: Create/Apply disabled when unchanged (edit), name empty, regex invalid or saving.
  Same in-flight rules as `TransactionEditDialogComponent` (`disableClose`, no destroy-bound
  subscription, `toSaveError` → conflict / cycle / generic message in the footer).
- **Prefill from a transaction** (`categoryDraftFrom(transaction)`, pure + spec): name and pattern
  = trimmed `empfaenger_name` (commas escaped as `\,` so Hibiscus does not split the term); no
  name → both empty; `umsatztyp` from the sign of `betrag` (<0 expense, >0 income, 0 any);
  `isregex` 0, everything else null.

### Store updates after save

- `TransactionsStore.saveCategory`: on success replace/append the row in `categories` (new array)
  — `categoryPathsById` and `categoryAssignment` recompute, the by-category tree updates in place
  by row id.
- `CategoriesStore` (new, provided in `CategoriesComponent`): moves the page's loading into a store
  and additionally loads transactions (needed for the preview); same `saveCategory`.

### Menus

- `TransactionDialogs.menuItems`: single-row menu gains **Create category** (after Assign;
  disabled in the bulk menu).
- `TransactionsByCategoryComponent`: category nodes (non-null) → `[Edit]`.
- `CategoriesComponent`: `getContextMenuItems` → `[Edit]`.

### i18n / docs

- Keys under `categories.edit.*` and `transactions.menuCreateCategory` in `en.json` + `de.json`.
- `docs/architecture.md`: write scope (categories no longer read-only), API table (POST/PUT),
  categories page section, matching module move. `transactions-table` skill: new menu entry +
  matcher location.

## Phases & execution

| Step                               | Agent             | Model/effort  | Wave | Write set                                                                                                             | Reads                                                   |
| ---------------------------------- | ----------------- | ------------- | ---- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A Backend + contract               | implementer       | sonnet/medium | 1    | shared `categories.d.ts`, backend `umsatztyp.ts`, `categories/category-update.ts`, `routes/categories.ts`, specs      | `transactions.ts`, `transaction-update.ts`, `umsatz.ts` |
| B Matching refactor + colour utils | implementer       | sonnet/medium | 1    | `core/utils/category-matching.ts`(+spec, moved), `category-color.ts`(+spec), import sites                             | `category-assignment.ts` + spec                         |
| C API + stores + prefill           | implementer-light | haiku/low     | 2    | `api.service.ts`(+spec), `transactions.store.ts`(+spec), new `categories.store.ts`(+spec), `category-draft.ts`(+spec) | contract from A                                         |
| D Dialog + opener (UI)             | implementer       | sonnet/high   | 3    | `features/categories/edit-dialog/*`, `category-dialogs.ts`, i18n                                                      | B, C, `transaction-edit-dialog.*`, `_dialog.scss`       |
| E Menu wiring                      | implementer-light | haiku/low     | 4    | `transaction-dialogs.ts`, by-category + categories components (+specs), i18n                                          | D                                                       |
| F Docs                             | implementer-light | haiku/low     | 4    | `docs/architecture.md`, `.claude/skills/transactions-table/SKILL.md`                                                  | —                                                       |
| G Quality gates + browser check    | main session      | —             | 5    | —                                                                                                                     | —                                                       |

Waves as executed: 1 = A, B, C (contract + dialog model pinned in Phase 0); 2 = C2, D, F; 3 = E; 4 = G.

## Sub-phases

### Phase 0 — Pin contract + dialog model (main session)

- **Status:** done
- **Started:** 2026-10-16 16:49
- **Ended:** 2026-10-16 16:52

### Phase A — Backend + contract

- **Status:** done
- **Started:** 2026-10-16 16:52
- **Ended:** 2026-10-16 16:56

### Phase B — Matching refactor + colour utils

- **Status:** done
- **Started:** 2026-10-16 16:52
- **Ended:** 2026-10-16 16:56

### Phase C — API, categories store, prefill

- **Status:** done
- **Started:** 2026-10-16 16:52
- **Ended:** 2026-10-16 16:56

### Phase C2 — TransactionsStore.saveCategory

- **Status:** done
- **Started:** 2026-10-16 16:55
- **Ended:** 2026-10-16 16:57

### Phase D — Dialog + opener (UI)

- **Status:** done
- **Started:** 2026-10-16 16:55
- **Ended:** 2026-10-16 17:01

### Phase E — Menu wiring

- **Status:** done
- **Started:** 2026-10-16 17:02
- **Ended:** 2026-10-16 17:06

### Phase F — Docs

- **Status:** done
- **Started:** 2026-10-16 16:53
- **Ended:** 2026-10-16 16:54

### Phase G — Quality gates + browser check

- **Status:** done
- **Started:** 2026-10-16 17:07
- **Ended:** 2026-10-16 17:30

## Verification

- `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build` — all clean.
- Backend specs: create returns the row; update 204/404/409; cycle → 400; unknown parent/account → 400;
  invalid body → 400.
- Unit specs: matcher parity (existing assignment spec passes unchanged after the move), preview
  status classification, prefill, colour conversion.
- `pnpm start:local`, browser (Chrome tools): right-click a transaction → Create category → preview
  shows that transaction "assigned here"; type a regex → table updates live; break the regex →
  error + Create disabled; Create → by-category tab regroups. Categories page → right-click → Edit →
  change pattern → Apply → tree row updates; stale edit (change in DB meanwhile) → conflict message.

Outcome: all gates green (94 backend, 441 frontend tests); pre-existing bundle-budget warning unchanged. `saveCategory` shared via `features/categories/save-category.ts`. Browser check passed: Create category from a transaction (prefill, 54 hits), live regex preview, invalid regex disables Create, status column incl. "claimed first by", Create stored the row, Edit → Apply stored the change, a stale edit shows the conflict message, dark mode. Test category (id 400) deleted from the local DB afterwards. Notes: DB is `utf8mb3` (4-byte characters fail with 500); `pattern` is `TEXT` locally (cap 21,845 chars).
