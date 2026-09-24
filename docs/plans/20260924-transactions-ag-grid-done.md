# Transactions table → ag-Grid (`BaseTableComponent`) with server-chunked pagination

## Context

The transactions view (`packages/frontend/src/app/features/transactions/`) renders a hand-written
`<table class="transaction-table">`. The `angular-ag-grid-table` skill requires every table to go
through one shared `BaseTableComponent extends AgGridAngular` that carries the project theme. Today:
no ag-Grid dependency, no `BaseTableComponent`, no `ag-dev` skill, no shared table code. This is the
only `<table>` in the app.

User decisions so far:
- Install `ag-grid-community` + `ag-grid-angular` **and** the `ag-dev` skill (approved).
- **Pagination = hybrid server chunks**: ag-Grid's client-side row model paginates within a loaded chunk;
  the frontend fetches the next chunk when the user pages past it; the backend must support it.
- **DB column names stay German** (Hibiscus compatibility, no schema change). **Visible labels come from
  the translations (i18n, just integrated in `fa7c95f`), never from field names.**

Findings that shape the design:
- **The transactions API contract has drifted.** Backend `GET /api/transactions` returns repository rows
  verbatim (`betrag`, `zweck`, `zweck2/3`, `empfaengerName/2`, `kontoId`, `datum`, `umsatztypId`; params
  `limit`/`offset`, max 200) and `PATCH` answers `204`. Frontend `Transaction`/`TransactionsQuery`
  (`amount`, `purpose`, `counterparty`, `accountId`, `categoryId`; `page`/`pageSize`) and
  `ApiService.updateTransactionCategory` (expects a row back) don't match; it only "works" because specs
  mock the API. Per `core.md` "Shared contracts" this is the bug to fix, not to mirror.
  (`Account` etc. have the same kind of drift → **out of scope**, flagged to the user at the end.)
- Column headers already use i18n keys (`transactions.colDate` … `colCategory`); `LocaleService.locale`
  is passed to `DecimalPipe`. ag-Grid must use the same mechanism (reactive to locale switches).
- Themes style the old table's DOM: greenbar zebra (`.transaction-table tbody tr:nth-child(even) td`) and
  the signed/parenthesised amount spans (vault, private, telex, greenbar). ag-Grid's DOM is div-based →
  port these.
- `pool.ts` uses `dateStrings: true`, so `datum` is already a `YYYY-MM-DD` string.
- Monorepo: pnpm `packages/*` (new package is picked up automatically), backend `tsc` with
  `module: node16` and `rootDir: src`, Angular esbuild `moduleResolution: bundler`, Dockerfile copies each
  `package.json` before install, Turbo `build` has no `^build` dependency yet.

Ground rules: component SCSS structural-only, visuals via `--base-table-*` tokens defaulting to global
tokens (`frontend.md`); no barrel files; no `any`; explicit annotations; ≤3 params; no silent defaults;
work on a feature branch; **no commit/push unless asked**.

## Design

**Shared contract** — new types-only package `packages/shared` (`@hibiscus-frontend/shared`, subpath
`/contracts`), built with `tsc --emitDeclarationOnly`, Turbo `build` gets `dependsOn: ["^build"]`.
Types: `Transaction` (moved out of `backend/src/repositories/umsatz.ts`, **same German field names** —
they mirror the DB; the repo keeps its private snake_case row type + mapper), `TransactionsQuery`
(`accountId? from? to? categoryId? q? limit offset`), `TransactionListResponse` (`items`, `total`).
Backend and frontend both `import type` from it; the frontend `transaction.model.ts` becomes
re-exports/extends (or is deleted). No runtime code in the package, so the runtime Docker image is unaffected
(only the builder stage needs `packages/shared/package.json` copied before install).

**Chunked pagination**
- Constants: `PAGE_SIZE = 20` (grid page), `CHUNK_SIZE = 500` (a multiple of `PAGE_SIZE`, below the API cap).
- Backend: `limit`/`offset` already exist → raise `MAX_LIMIT` 200 → 1000 (safety cap), keep the deterministic
  `ORDER BY datum DESC, id DESC` (stable chunk boundaries). Export the zod schema for a boundary test.
- Frontend `TransactionsComponent`: `page` = global 1-based page; `chunk = floor((page-1)/25)`,
  `pageInChunk = (page-1) % 25`. The query signal uses `chunk` (offset = chunk×500, limit = 500), **not**
  `page`, so paging inside a chunk doesn't refetch and the existing `debounce + distinctUntilChanged +
  switchMap` pipeline keeps working. Filter change → `page = 1`. `total` from the API drives global page count.
- Grid: `pagination` on, `paginationPageSize = PAGE_SIZE`, built-in panel **suppressed**; the existing footer
  (translated `transactions.previous/next/pagination`) is the pager and drives
  `api.paginationGoToPage(pageInChunk)`. Reason: ag-Grid's own panel would only know the loaded chunk, not `total`.
- Column sorting/filtering/menus **disabled** (sorting a 500-row slice of a larger result would mislead).
- Known limit: rows inserted by the desktop client between chunk fetches can shift offsets (dup/skip at a
  boundary). Mitigation: `getRowId` (row id) + refetch on filter/chunk change; keyset paging is a follow-up if needed.

**i18n in the grid**: `columnDefs` is a `computed` reading `i18n.t('transactions.col…')` (re-evaluates on locale
switch); `localeText` built from existing keys (`transactions.empty`, `transactions.loading`) instead of
bundling ag-Grid's locale packs (SPOT: our dictionaries). Any new string → key in **both** `en.json` and `de.json`.
Amount cell formats with `LocaleService.locale`. The `field` names (`betrag`, …) are never displayed.

## Phases

### Phase A — Tooling
- **Status:** done
- **Started:** 2026-09-24 17:07
- **Ended:** 2026-09-24 17:10

1. Create branch. `pnpm --filter @hibiscus-frontend/frontend add ag-grid-community ag-grid-angular`
   (same version for both; check peer range covers Angular 21).
2. `npx skills add ag-grid/skills` (ag-dev); use it for **every** ag-Grid question below.
3. Ask ag-dev: theming mechanism (Theming API vs legacy CSS) and whether params accept `var(--…)` (needed
   for class-driven dark mode); module registration; `paginationGoToPage`/events for the external pager;
   `suppressPaginationPanel`; `loading`/overlay API; cell-renderer API for Angular 21 (inputs vs `agInit`);
   test-env guidance (virtualisation off). Record the theming URL in
   `../claude-config/skills/angular-ag-grid-table/references/api-index.md` (separate repo, separate commit).
4. Check `angular.json` budgets (ag-Grid is large); change them only with user sign-off.

### Phase B — Shared contract + backend chunking
- **Status:** done
- **Started:** 2026-09-24 17:10
- **Ended:** 2026-09-24 17:13

> Deviation: the shared package authors its contract directly as `.d.ts` (exports map `./contracts/*` → `src/contracts/*.d.ts`), so there is **no build step and no Turbo `^build` change** — TypeScript doesn't apply `rootDir` to declaration files, and the backend dist layout/runtime are verified unchanged.
>
> Found by the Docker build (not by the local checks): the runtime stage's `pnpm install --prod` still has to resolve `devDependencies`, and the workspace-only `@hibiscus-frontend/shared` can't be resolved there. Fixed in the `Dockerfile` by dropping `devDependencies` from the copied manifest in that stage; the shared package is types-only and erased at compile time, so the image has no runtime dependency on it (verified).


- `packages/shared/{package.json,tsconfig.json,src/contracts/transactions.ts}`; eslint/prettier/typecheck
  scripts like the other packages; add as `workspace:*` devDependency in backend + frontend.
- `turbo.json`: `build.dependsOn: ["^build"]`. `Dockerfile`: `COPY packages/shared/package.json` in the
  install layer. **Verify** the backend still builds with `rootDir: src` (declarations resolved from `dist`,
  so no TS6059) and that `dist/server.js` layout is unchanged.
- Backend: `repositories/umsatz.ts` imports `Transaction`; route returns `TransactionListResponse`; raise
  `MAX_LIMIT`; `export const TransactionsQuerySchema`; type-check that the parsed query is assignable to the
  shared `TransactionsQuery`.
- Backend tests: schema accepts `limit` up to the cap and rejects above it; `offset` default; existing
  `umsatz.spec.ts` stays green.

### Phase C — `BaseTableComponent`
- **Status:** done
- **Started:** 2026-09-24 17:13
- **Ended:** 2026-09-24 17:14

`src/app/core/components/base-table/` (existing cross-cutting components live in `core/components`).
- `export class BaseTableComponent extends AgGridAngular`, selector `app-base-table`, `OnPush`; **no**
  redeclared inputs/outputs; modules registered once (per ag-dev).
- Stylesheet bridges `--surface-*`, `--text-*`, `--color-accent*`, `--radius-base`, `--transition-duration` →
  ag-Grid params via component-scoped `--base-table-*` tokens; add `--base-table-row-alt-bg` (default
  `transparent`). Classlist/CSS only (no `ThemeService`); works for 5 identities × light/dark.
- Reduced motion baseline = none; opt-in under `prefers-reduced-motion: no-preference`; ≥44px targets for
  `pointer: coarse`; visible `:focus-visible` outlines on cells/headers.

### Phase D — Migrate `TransactionsComponent`
- **Status:** done
- **Started:** 2026-09-24 17:14
- **Ended:** 2026-09-24 17:17

- Replace the `@if/@else` table branch by a **kept-mounted** `<app-base-table>` with `[loading]="loading()"`,
  translated no-rows/loading text; keep filters form and error text; keep the pager footer.
- Typed `ColDef<Transaction>[]`: date (`datum`, `yyyy-MM-dd`), account (`valueGetter` via `accountsById()` on
  `kontoId`, `'—'` fallback), counterparty/purpose (`valueGetter`/renderer combining `empfaengerName(2)` and
  `zweck(2,3)`, two-line, `autoHeight` + wrap), amount (`betrag`, renderer), category (`umsatztypId`, renderer).
- `getRowId` → `String(id)`; `domLayout` per ag-Grid guidance so the page scrolls, not an inner viewport.
- Cell renderers (standalone, `features/transactions/cells/`):
  - `amount-cell`: both `.transaction-table__amount-signed` / `-paren` spans + `--negative`/`--positive`
    classes (keeps the per-theme rules working), `LocaleService` for number format.
  - `category-cell`: wraps `<app-category-picker>` + the translated "could not save" text; gets categories,
    handler and error id via grid `context` (or renderer params per ag-dev). Check focus interplay
    (picker focus trap vs grid keyboard navigation).
- Pagination wiring as in *Design*: `chunk`/`pageInChunk` computeds, query uses `chunk`, pager drives the grid
  API; after `rowData` changes the grid resets to page 0 → apply `pageInChunk` on the grid's row-data-updated event.
- `ApiService`: `getTransactions(query: TransactionsQuery)` maps `limit`/`offset` (drop `page`/`pageSize`);
  `updateTransactionCategory` returns `Observable<void>` (backend `204`); the component then applies
  `{ ...transaction, umsatztypId }` to `items` on success.
- Delete dead `.transaction-table*` rules from `transactions.component.scss` (amount base rules move to the
  amount cell's SCSS: `-paren` hidden by default, parentheses on negative).

### Phase E — Theme port
- **Status:** done
- **Started:** 2026-09-24 17:18
- **Ended:** 2026-09-24 17:19

- `_theme-greenbar.scss`: replace the `tbody tr:nth-child(even) td` stripe with
  `:root.theme-greenbar .base-table { --base-table-row-alt-bg: var(--surface-stripe); }`.
- vault/private/telex/greenbar amount rules keep matching (renderer keeps the `.transaction-table__amount-*`
  names); verify each. Confirm `--surface-stripe` exists in `styles/tokens.scss` (add a default if not).

### Phase F — Tests
- **Status:** done
- **Started:** 2026-09-24 17:19
- **Ended:** 2026-09-24 17:21

- `transactions.component.spec.ts`: rows now `.ag-row` / grid API instead of `tbody tr`; happy-dom has no
  layout → turn virtualisation off in tests (per ag-dev) and, if needed, add a `ResizeObserver` shim beside
  `utils/testing/mutation-observer-mock.ts` in the same style. Use the shared `Transaction` shape in fixtures.
- New pagination tests: page within a chunk → **no** new request; page past the chunk → one request with
  `offset=500`; filter change → back to page 1 / offset 0; pager label shows global page/total.
- New: base-table spec, amount-cell spec (signed + paren spans, classes, `de` vs `en` format), category-cell spec
  (selection emits; error text shows), i18n check (headers switch language).
- Backend tests from Phase B.

### Phase G — Wrap-up
- **Status:** done
- **Started:** 2026-09-24 17:21
- **Ended:** 2026-09-24 17:23

- Plan persisted as `docs/plans/20260924-transactions-ag-grid-<status>.md` (per `plan-mode.md`), renamed as status advanced.
- `docs/architecture.md`: API table (`limit`/`offset`, chunk cap, `PATCH` → `204`), Packages (add `shared`,
  types-only contract, single source of truth), note that tables go through `BaseTableComponent`.
- Checklist from the repo root, all clean: `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build`.
- Race review: stale chunk response vs newer filter (covered by `switchMap`), category `PATCH` completing after a
  chunk change (row not in `items` → no-op, must not throw or resurrect), pager click while loading.
- Tell the user: `Account` (and other) DTOs show the same drift and were not touched.

## Critical files
- New: `packages/shared/**`; `core/components/base-table/**`; `features/transactions/cells/{amount-cell,category-cell}/**`
- Edit: `features/transactions/transactions.component.{ts,html,scss,spec.ts}`, `core/services/api.service.ts`,
  `core/models/transaction.model.ts`, `backend/src/routes/transactions.ts`, `backend/src/repositories/umsatz.ts`,
  `styles/_theme-greenbar.scss`, `turbo.json`, `Dockerfile`, `packages/{frontend,backend}/package.json` (+ lockfile),
  `docs/architecture.md`
- Reuse: `CategoryPickerComponent`, `TranslationService`/`LocaleService`, existing `transactions.*` i18n keys,
  `buildCategoryTree`, `installLocalStorageMock`, `installMutationObserverMock`, backend `umsatz.spec.ts` patterns
- Other repo: `../claude-config/skills/angular-ag-grid-table/references/api-index.md`

## Verification
1. Checklist commands pass with no warnings (incl. production build/budgets and the Docker build stage
   `docker build .` if Docker is available).
2. `pnpm start:local` against real-shaped data (>500 rows): first chunk shows page 1 of N; paging within the
   chunk doesn't hit the network; crossing page 25→26 fetches once; filters reset to page 1; total is correct.
   Inspect network calls (`limit=500&offset=…`).
3. Language switch (en/de): headers, overlays, number format follow the locale; field names never appear.
4. 5 themes × light/dark: amount formats (signed vs parentheses, colours), greenbar zebra, header/border/hover
   follow tokens, no unstyled ag-Grid chrome.
5. Category change: overlay opens over the grid, saves, row updates; failure shows the inline error; keyboard
   (Tab into grid, Escape closes the picker, focus returns).
6. Narrow width + `pointer: coarse` emulation: no horizontal page scroll, 44px targets.
7. Visual checks (2–6) need the Chrome extension connected (it wasn't earlier) — otherwise the user verifies them.

## Outcome / open items

- Verified: format, lint, typecheck, tests (backend 20, frontend 62), production build, `docker build` + loading the
  compiled route in the image.
- **Not verified visually** (Chrome extension was not connected): layout, themes × light/dark, row heights /
  44px touch targets, category picker overlay over the grid, keyboard behaviour, >500-row paging against real data.
- `betrag` is typed `number`; confirm against a real Hibiscus DB that `mysql2` returns it as a number (not a string).
- Same contract drift exists for `Account` (and possibly categories/payees) — not touched here.
- ag-dev's docs told the agent to add `ag-grid-enterprise` when a feature needs it; deliberately **not** followed (Community only).
