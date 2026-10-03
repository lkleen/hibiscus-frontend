# Remove the Payees and Categories sections

## Context
The Categories (tree CRUD) and Payees (list/search) pages are no longer wanted. Remove both pages
from the frontend, plus the backend routes that become dead once they are gone. The transactions
table still needs `GET /api/categories` (category picker + category column) — that stays, together
with `Category`, `buildCategoryTree` (`core/utils/category-tree.ts`, used by `category-picker`).

Persist this plan as `docs/plans/20261003-remove-payees-categories-<status>.md` per plan-mode.md
(sub-phases with status/timestamps).

## Execution
All steps are mechanical deletions with exact paths, so each goes to an `implementer-light` agent
(haiku, low effort). A, B and C touch disjoint files → spawn all three **in parallel**, each with a
self-contained prompt listing only its own files and edits (no full plan, no extra context). Agents
do not run the quality gates; the main session only coordinates, reviews diffs and runs checks.

| Step | Agent | Order | Scope (files) |
|------|-------|-------|---------------|
| A — Frontend | implementer-light | parallel | `packages/frontend/src/**` listed in Phase A |
| B — Backend | implementer-light | parallel | `packages/backend/src/**` listed in Phase B |
| C — Docs | implementer-light | parallel | `docs/architecture.md` |
| Verify | main session | after A–C | grep + `pnpm format:fix/format:check/lint/test/build` |

No UI is added or restyled (only nav items removed), so no `frontend-design` step is needed.

### Phase A — Frontend
- **Status:** done
- **Started:** 2026-10-03
- **Ended:** 2026-10-03

- Delete `packages/frontend/src/app/features/categories/` (incl. `category-tree-item/`) and
  `packages/frontend/src/app/features/payees/`.
- `app/app.routes.ts`: drop the `categories` and `payees` child routes.
- `core/components/header/header.component.ts`: drop the two nav entries (`nav.categories`, `nav.payees`).
- Delete `core/models/payee.model.ts`.
- `core/models/category.model.ts`: remove `CreateCategory` and `UpdateCategory` (keep `Category`,
  `CategoryTreeNode`).
- `core/services/api.service.ts`: remove `createCategory`, `updateCategory`, `deleteCategory`,
  `getPayees` and the now-unused imports (`Payee`, `HttpParams` if unused).
- `core/services/api.service.spec.ts`: remove the "POSTs a new category", "DELETEs a category" and
  "/api/payees" tests.
- `src/i18n/en.json` + `de.json`: remove `nav.categories`, `nav.payees`, all `categories.*`,
  `categoryTree.*`, `payees.*` keys (grep first to confirm none is used elsewhere).

### Phase B — Backend
- **Status:** done
- **Started:** 2026-10-03
- **Ended:** 2026-10-03

- Delete `packages/backend/src/routes/payees.ts` and `repositories/empfaenger.ts`.
- `server.ts`: remove the payees router import/mount.
- `routes/categories.ts`: keep only `GET /`; remove create/update schemas, `CategoryIdParamsSchema`,
  POST/PATCH/DELETE handlers and the `respondWithValidationError`/`zod` imports; update doc comment.
- `repositories/umsatztyp.ts`: remove `createCategory`, `updateCategory`, `deleteCategory`,
  `CreateCategoryInput`, `UpdateCategoryInput`, `ResultSetHeader` import.

### Phase C — Docs
- **Status:** done
- **Started:** 2026-10-03
- **Ended:** 2026-10-03

- `docs/architecture.md`: remove `POST/PATCH/DELETE /api/categories` and `GET /api/payees` from the
  API table; `empfaenger` no longer a used table (drop the row or move to "not used"); rewrite the
  write-scope paragraph (only `umsatz.umsatztyp_id` and `hf_user_setting`); drop "and payee" from
  the i18n note only if it reads oddly (payee names still appear as transaction data — keep).
- `README.md` line 4 already says "accounts, transactions, categories" — fine, leave.
- Leave historical `docs/plans/*-done.md` untouched.

## Verification
- `grep -rn "payee\|Payee\|createCategory\|categoryTree\.\|categories\.\(title\|add\)" packages/*/src` → no hits beyond intended.
- `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build` — all green, no warnings.
- `pnpm start:local`: header shows only Accounts/Transactions; `/en/categories` and `/en/payees`
  fall through to the `**` redirect; transactions category picker still loads and saves.
