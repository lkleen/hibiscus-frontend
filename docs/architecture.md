# Architecture

## Packages

- `packages/backend` — Node 22 + Express + TypeScript. Owns the MariaDB connection (`mysql2`,
  no ORM) and the forward-auth middleware. Serves the JSON API under `/api/*` and, in the
  production Docker image, the built frontend as static files.
- `packages/frontend` — Angular (CDK only, no Material) single-page app that consumes the API.
  All tables use the generic `<app-data-table>` component (`app/shared/components/data-table/`),
  which wraps PrimeNG's `p-table` with an ag-Grid-shaped API: raw rows, and column-owned lambdas
  (`valueGetter`, `valueFormatter`, `comparator`, `filterValueGetter`, `getQuickFilterText`)
  evaluated live, never materialised onto rows. Column sizing via `autoSizeStrategy`
  (`fitGridWidth` / `fitProvidedWidth` / `fitCellContents`) and drag-resize (default on, 'expand'
  mode) are done in pure CSS. Columns can be reordered by dragging their header (default on,
  `columnReorder` option), order kept for the session only. The component offers an ag-Grid-style
  `externalFilter` input (a caller-supplied predicate applied before table filters, resetting to
  page 1 on change) and two projection slots for additional filters: `[appDataTableToolbarStart]`
  before the search field and `[appDataTableToolbar]` after it. The `quickFilterText` input (ag-Grid's
  name) replaces the table's own search field: when non-null the field is hidden and the table filters
  with that text through the same path (tree-lenient in tree mode). The `density` input (default
  `normal`) renders as a `table-density-<id>` host class that `_primeng-table.scss` maps to the table
  tokens; tables without a chosen density (pickers, dialog previews) are Normal. Features are added to the component, never implemented per table. Theming goes
  through the CSS bridge in `styles/_primeng-table.scss`. The component optionally renders a tree
  via the `treeData` option (self-referencing parent-id style, built by `buildTree`); it renders
  PrimeNG's `p-treetable` instead of `p-table` and shares all column models and lambdas. Trees are
  fully expanded by default with expand-all/collapse-all controls (icon buttons with a tooltip at the end of the
  toolbar row; a page that owns the toolbar row, like the transactions shell, provides
  `DataTableToolbarOutlet` and the table attaches them, together with its projected
  `[appDataTableToolbar]` content, to that page's `cdkPortalOutlet` instead (the ribbon's View band);
  nodes are updated in place by row id when `value` changes, so expansion survives data changes); the quick filter is lenient
  (keeping ancestors of matches), sorting and resizing work, and pagination is not available.
  In tree mode a column may set `aggFunc: 'sum'`: group nodes then show and sort by the sum of their
  descendant leaves' values (computed once per tree rebuild; throws outside tree mode). The pure
  `quickFilterMatches(row, columns, query)` (`data-table.defaults.ts`) reproduces the table's own
  quick filter for rows rendered elsewhere.
- `packages/shared` — types-only API contracts, imported by both packages (see
  [Shared contracts](#shared-contracts)). No runtime code and no build step.

## Data model

Backed by a MariaDB database matching the schema Hibiscus (the desktop Jameica/Hibiscus
home-banking client) creates via its own `mysql-create.sql`. This repo never owns or migrates
that schema — it only reads/writes against tables that already exist, with these exceptions: the
app-owned `hf_` tables (`hf_user_setting` for per-user settings, `hf_tax_section` and
`hf_category_tax_tag` for the user's tax sections and category tax tags; see below), created at startup.

Tables this app uses:

| Table                 | Purpose                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `konto`               | Bank accounts — name, IBAN/BIC, currency, current balance                                        |
| `umsatz`              | Transactions/bookings — amount, purpose text, counterparty, date, FKs to `konto` and `umsatztyp` |
| `umsatztyp`           | Categories — self-referencing tree via `parent_id`, has a `color` column                         |
| `hf_user_setting`     | Per-user app settings; keyed by `(user_name, setting_key)` with JSON value; created at startup   |
| `hf_tax_section`      | User-maintained tax sections (code, name, form, guidance); default sections seeded once          |
| `hf_category_tax_tag` | One tax tag per category; FKs to `umsatztyp.id` (cascade) and `hf_tax_section.code`              |

Not used by v1 (future work): `dauerauftrag`/`sepadauerauftrag` (standing orders),
`lastschrift`/`sepalastschrift` (direct debits), `kontoauszug` (statements), `protokoll`,
`reminder`, `systemnachricht`, `empfaenger` (payee address book).

Write scope is per-user settings (date range presets, table densities per view) in `hf_user_setting`, tax sections in `hf_tax_section`, tax tags in
`hf_category_tax_tag`, and two
user-maintained fields of `umsatz`: `kommentar` and `umsatztyp_id` (the category), via
`PATCH /api/transactions/:id`. Both are written in one atomic `UPDATE ... WHERE` that only succeeds
while the row still holds the values the edit started from (`expected`); otherwise the API answers
`409`, e.g. when the row was changed in the Hibiscus desktop client. Bulk category assignment
(`POST /api/transactions/assign-category`) writes only `umsatztyp_id` and only compares `kommentar`.
It runs one `UPDATE ... WHERE` per row, in ascending id order, inside a single DB transaction: if any
row does not match its `expected` values, the whole batch is rolled back and nothing is saved. The JSON
body limit for this route is 10 MB (`server.ts`). No other column of `umsatz` is ever written. The category table `umsatztyp` is written too, every
column but `id`: `POST /api/categories` inserts a row, and `PUT /api/categories/:id` updates one
(`expected`/`next`) with one `UPDATE … WHERE` that compares every column with `<=>`, in one DB
transaction, under the same `409` guard as transaction edits. Both carry the category's tax tag
(`taxTag`), written in the same DB transaction (see Tax sections and tags). There is no delete. Bank-imported transaction
fields (amount, date, counterparty) are synced from the bank by the desktop client and are not this
app's data to change.

## API (v1)

All routes are under `/api` and require authentication (see below) except `/api/me`, which
itself requires authentication too — there is no unauthenticated route in this app at all.

| Method & path                            | Purpose                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/me`                            | Echoes the authenticated identity                                                                                                                                                                                                                                                                                                                 |
| `GET /api/accounts`                      | List `konto` rows, as stored (`AccountRow`)                                                                                                                                                                                                                                                                                                       |
| `GET /api/transactions`                  | Every `umsatz` row, as stored, unfiltered and unpaged — columnar (`TransactionsResponse`)                                                                                                                                                                                                                                                         |
| `PATCH /api/transactions/:id`            | Change `kommentar` and/or `umsatztyp_id` (`TransactionUpdateRequest`: `expected`, `next`); `204`; `400` invalid id/body or unknown category; `404` no such row; `409` if the row no longer holds `expected`                                                                                                                                       |
| `POST /api/transactions/assign-category` | Set `umsatztyp_id` on 1–10,000 selected rows (`TransactionAssignRequest`: `items` of `{ id, expected: { kommentar, umsatztyp_id } }`, `umsatztyp_id`); one DB transaction, all-or-nothing; `204`; `400` invalid body or unknown category; `409` `{ error: 'conflict', conflictIds }` if any row no longer holds its `expected`, nothing saved     |
| `GET /api/categories`                    | List `umsatztyp` rows, as stored (`CategoryRow`)                                                                                                                                                                                                                                                                                                  |
| `POST /api/categories`                   | Create a `umsatztyp` row (`CategoryCreateRequest`: every column but `id` plus `taxTag`, zod-validated); answers `201` with the created `CategoryRow` as stored; `400` invalid body, unknown parent/account or unknown tax section                                                                                                                 |
| `PUT /api/categories/:id`                | Change every editable column (`CategoryUpdateRequest`: `expected`, `next`, `taxTag`); one DB transaction with the tag; `204`; `400` invalid body, unknown parent/account, or `{ error: 'cycle' }` when the new parent is the category itself or one of its descendants; `404` no such row; `409` if the row or its tag no longer holds `expected` |
| `GET /api/settings/date-presets`         | User's date presets; defaults if not stored                                                                                                                                                                                                                                                                                                       |
| `PUT /api/settings/date-presets`         | Save whole preset list (zod-validated); answers `204`                                                                                                                                                                                                                                                                                             |
| `DELETE /api/settings/date-presets`      | Restore defaults; answers `204`                                                                                                                                                                                                                                                                                                                   |
| `GET /api/settings/table-densities`      | User's stored density map (`TableDensities`, view → density); `{}` if not stored                                                                                                                                                                                                                                                                  |
| `PUT /api/settings/table-densities`      | Save the whole map (zod-validated); answers `204`                                                                                                                                                                                                                                                                                                 |
| `GET /api/tax-tags`                      | Every tax tag (`TaxTag[]`: `category_id`, `code`)                                                                                                                                                                                                                                                                                                 |
| `GET /api/tax-sections`                  | Every tax section (`TaxSection[]`), ordered by code; never the built-in `St-0`                                                                                                                                                                                                                                                                    |
| `POST /api/tax-sections`                 | Create a section (`TaxSection`, zod-validated); `201` with the section as stored; `400` invalid body or code; `409` `{ error: 'duplicate' }` when the code is taken                                                                                                                                                                               |
| `PUT /api/tax-sections/:code`            | Change a section (`TaxSectionUpdateRequest`: `expected`, `next`; a new code carries its tags along); `204`; `400` invalid body or `:code` ≠ `expected.code`; `409` `conflict` (changed or gone) or `duplicate`                                                                                                                                    |
| `DELETE /api/tax-sections/:code`         | Delete a section; `204`; `404` no such section; `409` `{ error: 'in-use' }` while a category is tagged with it                                                                                                                                                                                                                                    |

### Shared contracts

`packages/shared` declares the API request/response types once
(`@hibiscus-frontend/shared/contracts/transactions`, `…/accounts`, `…/categories`); the backend
routes and repositories and the frontend `ApiService` both import them, so the two sides cannot
drift apart. They are authored as `.d.ts` files, which TypeScript type-checks but never emits, so
the package needs no build step and the backend's `dist/` layout is unchanged.

`GET /api/categories` returns `CategoryRow` rows: the `umsatztyp` columns as stored. The `color`
column is stored as `"r,g,b"` (comma-separated bytes, as Hibiscus writes it); rows edited by this
app's former categories page may hold `#rrggbb` instead. The colour is displayed only when `customcolor = 1`. The frontend
converts both formats to CSS via `toCssColor()` (`core/utils/category-color.ts`). New colours are
written back in the `"r,g,b"` format. The category write routes use `CategoryEditableFields` (every
column but `id`), `CategoryCreateRequest`, `CategoryUpdateRequest` and `CategoryCycleError`, all
declared in `@hibiscus-frontend/shared/contracts/categories`.

`GET /api/transactions` returns the selected `umsatz` columns exactly as the DB has them
(`TransactionRow`: `konto_id`, `empfaenger_name`, `betrag`, `zweck`, `umsatztyp_id`, …). To keep
the payload small it is columnar (`TransactionsResponse`): the column names once in `columns`, then
each row as an array of its values in that order (`mysql2`'s `rowsAsArray`, so the backend does no
per-row mapping; about 40% smaller than an array of objects). `ApiService.getTransactions()` turns
it back into `TransactionRow` objects, so everything past the service sees plain rows. The
backend neither renames nor derives anything — the DB layout is fixed for compatibility with the
desktop client, and the API mirrors it one-to-one. The UI never displays a column name: every
visible label (column headers included) comes from the translations.

`GET /api/accounts` does the same for `konto` (`AccountRow`). Note that `konto.name` is the account
_holder_ (the same on every account); an account's own label is `bezeichnung`.

The transactions table shows every meaningful `umsatz` column as stored — the ids are the only
values it resolves: `konto_id` to the account's holder, BIC, account number and label (four plain
columns looked up from `/api/accounts`) and `umsatztyp_id` to the stored category's root-to-leaf path (from
`/api/categories`; not the pattern-matched category of the by-category tab). `kommentar` and
`flags` are shown as stored. What the text
columns contain differs by account and over time (bank/Hibiscus import formats), so the table does not interpret them.

### User settings

Per-user settings are keyed by the forward-auth identity and stored in `hf_user_setting`. The
shared contract `@hibiscus-frontend/shared/contracts/user-settings` defines the setting types.

**Date presets** (first setting): relative units like "current month" or fixed date ranges, each
named or auto-generated, the first preset auto-selected on page load. Defaults live only in the
backend (`DEFAULT_DATE_PRESETS`); the user is never "no presets", they always have at least the
defaults.

**Table density** (second setting): density is per view, not global. The shared types are
`TableViewId` (`'transactions-list' | 'transactions-by-category' | 'categories'`) and `TableDensities`
(a partial map from view to `TableDensity`, one of `extra-compact | compact | normal | comfortable |
spacious`; a missing view is `normal`). The backend stores the whole map under one `hf_user_setting` key.
The old single `table-density` setting is removed and never read. Frontend `TableDensityService` loads
the map once at app startup, exposes `densityFor(view)` and `save(view, density)`, and does not touch
`<html>`. The density is picked in the ribbon's View tab via `<app-density-picker [view]>`; each
`<app-data-table>` takes it as its `density` input (see the data table paragraph above).

All settings services (date presets, table densities) share the load-once / serial-write-queue /
confirmed-state-only logic via `UserSettingChannel<T>` (`core/services/user-setting-channel.ts`): reads
and writes go through these services, which load settings once at app startup, queue all writes through a single serial
channel (so the server receives them in order), and only surface confirmed state to the UI
(unsaved changes are not displayed).

### Transactions page

The page at `/:locale/transactions` is a tabbed shell (`TransactionsComponent`) with a single
`TransactionsStore` provided in its `providers`, so every tab shares the same loaded data and filter
state. Switching tabs never refetches.

**Shell and tabs.** The route is `/:locale/transactions` with two child-route tabs: `list` (the
transaction table) and `categories` (a by-category report tree). Both paths are defined in
`TRANSACTIONS_TABS` (`transactions-tabs.ts`), a single source like `SETTINGS_TABS` that pairs each
tab's route segment with its `labelKey` for the i18n tab label, its `densityView` (the `TableViewId`
whose density the table uses) and its `loadComponent` for lazy loading. The shell redirects the empty path to the first tab.

**Ribbon.** Above the `<router-outlet>`, the shell renders a ribbon (see [Ribbon toolbar](#ribbon-toolbar))
with three bands. **Filter**: search (debounced 300 ms via `searchInput` → `debouncedSearch` to avoid
recomputing filters on every keystroke) and `<app-account-filter>` (dropdown with one checkbox per
account, unchecked = excluded; session-only state is the set of unchecked account ids); its state is
the accounts summary. **Period**: `<app-date-range-filter>` (filters on `datum`, starting on the user's
first preset, session-only), split into Preset, Range and Step groups; its state is the range. **View**:
the active tab's view controls. The by-category tab's tree expand/collapse-all buttons reach it through
`DataTableToolbarOutlet`, whose `cdkPortalOutlet` sits in this band on that tab only; the density
picker shows the density of the active tab's view (`densityView`). The list and by-category tabs each
register a contextual **Selection** tab ("N selected", Clear selection) while rows are ticked, so the
tables need no toolbar row of their own.

**`TransactionsStore`.** Loaded once at shell creation via `forkJoin` (accounts, transactions,
categories), it exposes: `accounts`, `transactions` (the raw 10,000 rows, about 530 KB on the wire;
backend gzips), `categories`, `range`/`excludedAccountIds`/`search` signals (the filter inputs),
`accountsById` (computed map), `transactionColumns` (list-tab column definitions, moved here because
search needs them), `rowFilter` (computed predicate: account + date + search combined into one,
`null` when nothing restricts), and `filteredTransactions` (computed, all rows minus the filter).
Leaving `/transactions` destroys the store and coming back refetches; tab switches do not.

**List tab** (`TransactionsListComponent`). Today's table, now mounted on the shell's outlet. Loads
`[value]="store.transactions()"`, sets `[externalFilter]="store.rowFilter()"` (the ribbon's
combined filter), uses `quickFilter: false` (search is the shell's, not per-row), and
`autoSizeStrategy: fitCellContents` with an 82rem floor (cells single-line, table scrolls). Column
definitions live in `transactionColumns` (store) and include `valueGetter` lambdas resolving
`konto_id` to account details (holder, BIC, number, label); values are computed live, not on rows.
Sorts by value date (`valuta`) ascending by default, ties broken by id ascending. Columns
start with value date, amount, balance and purpose 1–3. The row context menu offers View, Edit and
Assign (tooltip): Edit and Assign open dialogs (`TransactionDialogs`, one at a time, closed with
the shell) that save through `TransactionsStore.saveTransaction`; Assign picks a category in the
shared `<app-category-picker>` tree and saves at once.

**By-category tab** (`TransactionsByCategoryComponent`). Reproduces Hibiscus's "Umsätze nach
Kategorien" report. It builds a tree from the filtered transactions using `buildCategoryReport()`
(pure function). The tree has two row kinds: category nodes (wrapping `CategoryRow | null`, where
`null` is the "Unassigned" node always present) and transaction leaf rows (wrapping raw
`TransactionRow`). Category nodes show recursive sums (amount, income, expenses) via `aggFunc: 'sum'`
and are ordered by `nummer` then `name` (unassigned last); transactions are ordered by booking date
descending then id. Categories flagged `FLAG_SKIP_REPORTS` (bit 1) and their transactions are
excluded. The tree is collapsed by default; expand-all/collapse-all controls expand/collapse all
nodes at once. Invalid category regex patterns are listed in a visible warning above the tree.

**Category assignment.** The by-category tab groups transactions using Hibiscus's own assignment
rule: stored `umsatztyp_id` wins; when NULL or unknown, the first matching category by `ORDER BY
COALESCE(nummer,''), name` is used; when no category matches, the transaction is unassigned. A
category matches when its type and account scope fit and its pattern (if set) matches the
transaction's searchable fields. The `assignCategories()` function in `core/utils/category-matching.ts`
implements this exactly, including Hibiscus's comma-split non-regex patterns and full-match regex
(Java `matches()`, emulated with `^(?:pattern)$`). Grouping only — displayed values stay raw. This is
a documented exception to the transactions-table skill's "never interpret" rule, scoped to that
grouping logic only.

**Selection and bulk assign (both tabs).** Each table has a checkbox column for multi-row selection
(in the by-category tree only transaction rows are selectable). The header checkbox selects every row
passing the shared filters, across all pages; Ctrl/Cmd-click toggles a row, and in the list Shift-click
selects a range. The selection is pruned to the rows passing the filters whenever they change, and the
active tab's contextual Selection tab shows "N selected" with a Clear action (the tab is absent
while nothing is selected). Right-clicking a row inside a multi-row selection
disables View and Edit and makes Assign assign all selected rows in one request
(`TransactionsStore.assignCategory`, see the write scope above); right-clicking outside the selection
opens the single-row menu. After a successful bulk assign the selection is cleared.

**Served but not displayed.** Four columns are served for category matching but not shown in either
tab: `purposecode`, `mandateid`, `creditorid`, `customerref`. These (and the displayed `kommentar`)
appear in the assignment patterns as-is, used as searchable fields in `core/utils/category-matching.ts`.

### Categories page

A `/:locale/categories` page in the navigation shows the entire `umsatztyp` tree as a
table. Its ribbon has a Filter band (search, driving the tree through `quickFilterText`) and a View
band (expand/collapse-all and the density for view `categories`). Every column is rendered as stored: `type` is
translated (`0` = expense, `1` = income, `2` or `NULL` = any), `konto_id` is resolved to the
account label via `/api/accounts`, and the `flags` column's bit 1 (`FLAG_SKIP_REPORTS = 1`)
indicates "skip in reports". The `color` column is rendered via `toCssColor`. The "Tax section" column shows each category's effective
tax section (inherited ones muted, "Not tax-relevant" for `St-0`). Right-clicking a category and choosing
Edit opens the category dialog (below); the ribbon's "Tax sections…" button opens the tax sections
dialog. The page has its own `CategoriesStore` (`features/categories/categories.store.ts`),
which also loads the transactions for the dialog's preview.

### Category dialog

`CategoryEditDialogComponent` (`features/categories/edit-dialog/`), opened by `CategoryDialogs`, creates
or edits a category and covers every `umsatztyp` column: name, parent (`<app-category-picker>`, which
excludes the category itself and its descendants), pattern with the regex flag, type, account, account
category, number, colour, comment, the skip-in-reports flag, and the tax section ("As parent category",
a section, or "Not tax-relevant", with the chosen section's guidance underneath).

A live preview table (`<app-data-table>`) lists every transaction that the draft's pattern, type and
account scope match, updated as you type (debounced 300 ms). Its status column shows "assigned here",
"stored as ‹category›" or "claimed first by ‹earlier category›"; the last is computed by running
`assignCategories()` over the hits with the draft in place of the stored category. An invalid regex
shows an inline error and disables saving.

Nothing is saved until Create (new category) or Apply (edit). Saves go through a `CategoryEditSource`,
implemented by `TransactionsStore` and `CategoriesStore`, which puts the stored row into its
`categories` signal so the trees and the assignments recompute. Edits are protected by `expected` and
`409`, like transaction edits.

Entry points: the transactions list and the by-category transaction rows offer "Create category" in the
row menu (single-row menu only; disabled in the bulk menu). It opens the dialog prefilled from the
transaction (`categoryDraftFrom`, `features/categories/category-draft.ts`): name and pattern are the
counterparty name with commas escaped, and the type follows the amount's sign. On the by-category tab,
category nodes (not "Unassigned") offer Edit.

### Tax sections and tags

**Tax tags live in the app-owned `hf_category_tax_tag` table**, one row per tagged category, never
in a Hibiscus column. (`umsatztyp.nummer` was ruled out: it is the first key of Hibiscus's matching
order, `ORDER BY COALESCE(nummer,''), name`, so a tag there moved pattern-matched payments out of the
tagged category, in this app and in the desktop client.) A tag is a section code or the built-in
`St-0` (not tax-relevant, stops inheritance); a category without its own tag inherits its nearest
tagged ancestor's (`effectiveTaxSection`, `core/tax/tax-sections.ts`).

**Sections are the user's data** in `hf_tax_section`: code, name, form and four guidance texts
(what belongs, what does not, receipts to keep, a note), declared once as `TaxSection` in
`@hibiscus-frontend/shared/contracts/tax-tags`. Startup seeds the German defaults
(`packages/backend/src/tax/tax-section-defaults.ts`) exactly once — when the table is created, or when
the old one-column table is migrated — so a deleted section never comes back. The `St-0` row always
exists as the foreign key target and is never served, edited or deleted. The sections are maintained in
the tax sections dialog (`features/categories/tax-section-dialog/`) through `TaxSectionsService`
(`core/services/tax-sections.service.ts`) and `/api/tax-sections`.

Integrity is enforced by the DB: `category_id` references `umsatztyp(id)` with `ON UPDATE CASCADE`
(the tag follows a changed id) and `ON DELETE CASCADE` (a deleted category takes its tag along), and
`code` references `hf_tax_section(code)` with `ON UPDATE CASCADE` (renaming a section's code carries
its tags along) and `ON DELETE RESTRICT` (a section in use cannot be deleted; the API answers `409`
`in-use`). Startup fails if the tables or keys cannot be created.

A tag is saved only together with its category, in the category dialog: `POST`/`PUT
/api/categories` write the category and the tag in one DB transaction, and the update is guarded by
the tag the dialog opened with (`taxTag.expected`, read `FOR UPDATE`), so a tag changed elsewhere
answers `409` and nothing is saved. After a save the dialog updates `TaxTagsService`
(`core/services/tax-tags.service.ts`, read via `GET /api/tax-tags`).

**Export filter.** The by-category export can be limited to chosen tax sections ("Only tax-relevant
categories" in the export dialog): `filterReportByTaxSections` (`features/transactions/by-category/
category-report.ts`) keeps the transactions of categories whose effective section is chosen, plus
their ancestor category rows for the tree, and drops the unassigned node; the chosen sections are
named in the export's scope lines.

## Ribbon toolbar

`shared/components/ribbon/` is a generic MS-Office-style ribbon. A page provides `RibbonHost` and
renders `<app-ribbon ribbonId="…">`. Bands are `<ng-template appRibbonBand="id" ribbonLabelKey …>`
declared anywhere under the page, including routed child components, which is how a tab adds its
contextual band. Each band is laid out as `<app-ribbon-group captionKey>` (caption below, separators).
Each tab shows its band's state text and a dot when that band's settings restrict the rows. Contextual
tabs are accent-marked and shown only while `ribbonShown`. All bands stay rendered and inactive ones are
hidden, so band content keeps its state.

Three modes: full, tabs only (clicking the active tab collapses to tabs), and hidden (one slim line with
the bands' state chips and a "Show toolbar" button). The active tab and mode are kept per ribbon in
memory for the session (`RibbonStateStore`) and reset on reload.

## Authentication

This app never implements its own login, password storage, or session/JWT minting. It
**consumes** identity asserted by an upstream forward-auth proxy (Authentik, Keycloak behind
`oauth2-proxy`, Traefik forward-auth — the contract is generic and works with any of them).

The guarantee — **not accessible without the identity provider, even under misconfiguration** —
comes from two independent, always-on layers:

1. **Network isolation.** No Compose file in this repo ever publishes the app container's port.
   Only the fronting proxy service publishes a port; the app sits on an internal Docker network
   reachable only from that proxy.
2. **Shared secret, checked unconditionally.** The backend requires two things on every request,
   with no environment flag or mode that skips the check:
   - a configurable identity header (env `AUTH_HEADER_USER`, e.g. `X-Forwarded-User`)
   - a matching value in a second header carrying a pre-shared secret (env
     `INTERNAL_PROXY_SECRET`, compared in constant time)

   Missing or mismatched → `401`. A request whose identity header value isn't in the required
   `ALLOWED_USERS` allowlist (comma-separated usernames/emails) → `403`.

There is deliberately no `APP_ENV`-gated bypass anywhere near this check — an earlier draft of
this design trusted a plain dev-mode header with no secret, which would have been silently
exploitable if that mode's port were ever exposed by mistake. The fix was to delete that branch,
not harden it: the same check runs unconditionally in every environment.

Local, non-Docker development (`pnpm start:local`) gets its convenience from _outside_ the app:
`scripts/start-local.sh` generates a random `INTERNAL_PROXY_SECRET` into a gitignored
`.env.dev.local` on first run, and the Angular dev server's `proxy.config.mjs` injects that
secret plus a fixed identity header on every proxied request — exactly mimicking what a real
proxy sends. The backend cannot tell dev and production apart.

`docker-compose.auth-demo.yml` demonstrates the full contract end-to-end: Caddy is the one
published-port edge, using its `forward_auth` directive against `oauth2-proxy` (which handles
the actual Keycloak OIDC login) and copying the authenticated identity into the app's identity
header, then adding the shared secret itself via `header_up` before proxying to the
unpublished `app` service. This has been run and verified end-to-end, including a real Keycloak
login (see README.md) — not just written and assumed to work. Authentik's own forward-auth
outpost satisfies the identical `AUTH_HEADER_USER`/`ALLOWED_USERS`/`INTERNAL_PROXY_SECRET`
contract; the demo just needed one concrete, easy-to-run IdP to be a working example.

Three real bugs were caught by actually running this demo rather than trusting the design on
paper, all fixed in `auth-demo/Caddyfile` / `docker-compose.auth-demo.yml`:

- A bare top-level `header` directive sets _response_ headers, not the upstream request header —
  it was leaking the shared secret back to the client. Fixed with `header_up` inside
  `reverse_proxy`.
- Caddy reorders directives by a fixed precedence list regardless of file order, so
  `forward_auth` ran before the path-matched `reverse_proxy /oauth2/*`, gating oauth2-proxy's
  own sign-in page behind itself in an infinite redirect loop. Fixed by wrapping the three
  directives in an explicit `route { }` block, which runs them in the order written.
- Keycloak's discovery document by default advertises whatever address it was reached on, which
  is `keycloak:8080` (internal-only) for oauth2-proxy's own backend calls — unreachable by a
  browser. Fixed with `KC_HOSTNAME` (browser-facing endpoints) plus
  `KC_HOSTNAME_BACKCHANNEL_DYNAMIC` (keeps backend-to-backend endpoints on the internal
  address) and oauth2-proxy's `--insecure-oidc-skip-issuer-verification` (the strict issuer
  match otherwise rejects the resulting mismatch between the two).

TLS termination is the proxy's responsibility; this app only ever speaks plain HTTP behind it.

## Internationalization

The frontend ships two locales, `en` and `de`. There is no backend involvement: the API sends no
localized text, and database content (account, category and payee names, transaction purposes) is
user data and is shown as-is.

- **URL is the source of truth.** Every route is `/:locale/...`; `LocaleService` mirrors the first
  URL segment into a `locale` signal and sets `<html lang>`. Bare or unsupported-locale URLs
  redirect to `/{preferred}/accounts`, where preferred is `de` if `navigator.language` starts with
  `de`, else `en`. The locale is not persisted separately, so the URL alone decides it.
- **Dictionaries** live in `packages/frontend/src/i18n/{en,de}.json` and are bundled (imported as
  JSON, not fetched). `en.json` defines the `TranslationKey` type and `de.json` must satisfy
  `Record<TranslationKey, string>`, so a key missing in either file is a compile error. A spec also
  checks that placeholders match across locales.
- **`TranslationService.t(key, params?)`** resolves `{name}` placeholders and throws on a missing
  param. It reads the locale signal, so template calls update on language switch.
- **Number formatting** passes the locale explicitly to `DecimalPipe` (`LOCALE_ID` is fixed at
  bootstrap and cannot follow a URL change); German locale data is registered in `app.config.ts`.
  Dates stay ISO (`yyyy-MM-dd`).
- **Language switcher** is a submenu in the user menu, next to the theme submenu. It swaps the
  locale segment and keeps path, query params and fragment.

Adding a locale: add it to `SUPPORTED_LOCALES` (`core/models/locale.model.ts`), create its
dictionary, register it in `DICTIONARIES` (`core/models/translation.model.ts`), register its Angular
locale data in `app.config.ts`, and add a `locale.<code>` label to every dictionary.

## Settings

Per-user settings are accessed via a route-based tab interface at `/:locale/settings/<tab>`,
with all tabs defined in a single source (`SETTINGS_TABS` in `settings-tabs.ts`). The route
structure is: root shell component loads the active tab child route lazily. The first tab is
the default. Settings are reachable from the user menu. Currently implemented: one tab. **Date
range presets** shows a preset picker on the left; picking one saves it immediately. (The former
Table density tab and its demo table were removed; density is chosen in each page's ribbon.)

## Local development

See the root `README.md` for the full setup (including importing a data dump). In short:
`pnpm start:local` (`scripts/start-local.sh`) starts the local MariaDB container and both
packages together, with the auth contract satisfied automatically (see above) — no manual
token setup needed.
