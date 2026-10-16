---
name: transactions-table
description: Rules for the transactions table and by-category report (Hibiscus `umsatz`) across backend, shared contract and frontend views. Use BEFORE adding, changing or removing anything about transaction columns, the `/api/transactions` route or repository, `TransactionRow`, or sorting/filtering/paging. Columns are served and displayed exactly as stored; the backend never modifies them; sorting, filtering and paging are client-side PrimeNG `p-table` features. The by-category view applies a documented exception to group transactions.
---

# Transactions table

The transactions table shows the `umsatz` rows of the Hibiscus database. The data is imported from
banks by the Hibiscus desktop client, and **what a column contains differs by account and over
time** (SEPA `EREF+/KREF+/SVWZ+` markers on one bank, structured purpose lines on another, a "flat"
`zweck` with empty `zweck2`/`zweck3` since a Hibiscus update in May 2026). Interpreting the values
would only be right for some rows, so this app does not interpret them.

Files: `packages/backend/src/repositories/umsatz.ts`, `packages/backend/src/routes/transactions.ts`,
`packages/shared/src/contracts/transactions.d.ts` (`TransactionRow`),
`packages/frontend/src/app/features/transactions/` (shell, store, routes, list and by-category
tabs; `transactions-tabs.ts` is the single source for both tab definitions).

## 1. Columns are served exactly as stored (backend)

- Return every selected column **under its DB name with its DB value**: `konto_id`,
  `empfaenger_name`, `zweck3`, … — no camelCase renaming, no mapping function between row and
  response.
- The response is **columnar** (`TransactionsResponse`): `columns` lists the DB column names once,
  `rows` holds each row as its values in that order. `TRANSACTION_COLUMNS` in `umsatz.ts` is both
  the `SELECT` list and `columns`; the query uses `rowsAsArray: true`, so the driver's arrays go
  out untouched. `ApiService.getTransactions()` is the only place that turns them back into
  `TransactionRow` objects — the table and its specs only ever see plain rows.
- **Never** derive, merge, split, parse, trim, normalise, default or fix a column value
  (no "combine `zweck` + `zweck2` + `zweck3`", no "fall back to `zweck` when `empfaenger_name` is
  NULL", no repairing the broken umlauts in `art`). If a value looks wrong, it is shown wrong.
- `TransactionRow` (shared package) mirrors the selected columns one-to-one and is declared once;
  `TransactionColumn`/`TransactionValue`/`TransactionsResponse` are derived from it, and the
  backend and frontend import the same types. Never re-declare it, never add a second "view model" type for the API.
- The only write to `umsatz` is `PATCH /api/transactions/:id` (see the write scope in
  `docs/architecture.md`), and it writes only `kommentar` and `umsatztyp_id` (`TransactionEditableFields`),
  in one atomic `UPDATE … WHERE kommentar <=> expected AND umsatztyp_id <=> expected`. A stale save
  (the row no longer holds the values the edit started from, e.g. changed in the Hibiscus desktop
  client) answers `409`; it is never overwritten. Every other column, bank-imported fields above all,
  is never written.

## 2. Columns are displayed exactly as stored (frontend)

- Show the value as it is in the DB. Presentation only: the empty-value dash, ISO date part,
  number formatting for `betrag`/`saldo`. No content interpretation, no parsing of `zweck` text,
  no picking "the best" of several columns for one cell.
- Only ids are resolved to what they identify: `konto_id` → the account's own columns, added as
  four plain columns (holder `name`, `bic`, `kontonummer`, `bezeichnung`) looked up from
  `GET /api/accounts` by `konto_id` (`konto.name` is the holder, the same on every account);
  The `konto_id` itself is not shown. `umsatztyp_id` → the **stored** category's path from its root
  (`Living / Food / Supermarket`, names joined by `CATEGORY_PATH_SEPARATOR` in
  `core/utils/category-path.ts`), looked up from `GET /api/categories` by `umsatztyp_id` and the
  `parent_id` chain (one column; the id itself is not shown). This is not the
  pattern-matched category of §2.5 — a transaction without a stored id shows the dash.
- Show every **meaningful** column (filled on real data, not an empty legacy column); omit
  never-filled ones (`empfaenger_name2`, `primanota`, `addkey`, `txid`), plus `id` and
  `checksum`. `kommentar` and `flags` are shown as stored (`flags` as the raw number, no bit
  decoding). Four columns are served for category matching (in the by-category view) but not
  displayed in either tab: `purposecode`, `mandateid`, `creditorid`, `customerref` (almost always
  `NONREF`).
- Header labels come from the translations (`en.json` and `de.json`), never from field names.
  Labels must stay true to the raw column (`Purpose 1/2/3`, not "Type"/"Purpose").
- The row context menu has "View", which opens a details dialog with every displayed column of the
  list tab (same display rules; the four matching-only fields stay hidden), and "Edit", which opens
  the edit dialog for `kommentar` and the category (picked in a category tree, or unset with "No
  category"), and "Assign" (with a tooltip), which opens a dialog with the same searchable category
  tree where a pick saves the category at once ("No category" unassigns; the comment stays). Both
  tabs offer them on transaction rows (`showDetailsOf(store.transactionColumns, …)` for View,
  `TransactionDialogs.menuItems(row)` for Edit and Assign); the by-category tab's category rows keep
  the browser's own menu.

## 2.5. Category assignment (documented exception)

The by-category tab groups transactions by category using the Hibiscus assignment rule
(`UmsatzTypImpl.matches` + `UmsatzTypUtil`): stored `umsatztyp_id` wins; when NULL or unknown, the
first matching category by `ORDER BY COALESCE(nummer,''), name` is assigned. A category matches
when its type and account scope fit, and its pattern (if set) matches the transaction's searchable
fields. This is a deliberate interpretation of stored values, and **the only one** allowed in the
transactions views (see §1). It is scoped strictly to grouping: displayed values in both tabs stay
raw, and no value is modified by the assignment. The `assignCategories()` function
(`by-category/category-assignment.ts`) implements the rule exactly, including Hibiscus's comma-split
non-regex patterns and full-match regex (`Java matches()`, emulated with `^(?:pattern)$`). Invalid
regex patterns are reported as a visible warning, never silently ignored.

## 3. Sorting, filtering, paging: PrimeNG's `p-table`, not the backend

- Use `p-table`'s own features (column sort, column filters, the global filter, pagination), all
  client-side. The backend route does not sort, filter or page for the table's sake, and gains no
  `limit`/`offset`, filter or sort parameters on `GET /api/transactions`. The frontend does not
  re-implement any of this with hand-rolled state.
- **Date range filtering** and **account filtering** are the generic external filter mechanism:
  `<app-date-range-filter>` and `<app-account-filter>` in the shell's toolbar manipulate the
  `TransactionsStore`'s `range` and `excludedAccountIds` signals. The store's `rowFilter` computed
  (combining both, plus the search) is passed to both tabs' `externalFilter` input, filtering
  client-side. The date range picker starts on the user's first date preset and persists within the
  session only (no persistence between sessions); the account filter's state is the set of unchecked
  account ids (session only), so every account — including late-loading ones — starts checked.
- Before writing any table code, follow the `angular-primeng-table` skill. Use `<app-data-table>`
  in `transactions.component.html` — it wraps PrimeNG's `p-table` with column-owned lambdas and
  raw rows. It follows the active theme through the CSS bridge in `src/styles/_primeng-table.scss`.
- The backend returns all rows, `ORDER BY id` only for a deterministic response; that is transport,
  not table behaviour. The table loads every row in one request (about 10,000 rows) and does all
  sorting/filtering/paging on that in-memory set.
- **Lookups are `valueGetter`s in column definitions, evaluated live; rows stay raw.** The four
  account columns use `valueGetter` lambdas to resolve `konto_id` from the raw row. No `TransactionViewRow` — column definitions compute values live,
  and PrimeNG's sort, filters and search call the lambdas directly. This does **not** license
  reinterpreting a DB value: a `valueGetter` may only resolve ids and must never reinterpret stored
  values. §1/§2 still bind — lookups stay confined to the columns that need them.
- Per-column filters come from each column's `filter` type (`'text'`, `'numeric'`, `'date'` or
  `false`); `<app-data-table>` renders them as `<p-columnFilter … display="row" filterOn="input">`.
  `filterOn="input"` is required — v21 defaults to `'enter'`, which would silently drop the
  as-you-type behaviour the old floating filters had.
- **The date-filter trap is handled by the component's default `filterValueGetter` for
  `filter: 'date'`.** Date columns specify `filter: 'date'` in their `DataTableColDef`; the
  component's default `filterValueGetter` (in `data-table.defaults.ts`) calls `parseIsoDate` on the
  ISO string and returns a `Date` object to PrimeNG's date filter through the proxy. The visible
  cell and sort still show/use the raw ISO string (lexicographic order is already chronological).
  There is no `datum_date` any more.
- `globalFilterFields` is computed by `<app-data-table>` from the column definitions
  (one function per column with a `getQuickFilterText` lambda). Maintain the columns, and search
  updates automatically.
- To change a row in place, mutate the raw row and call `dataTable().refresh()`. In the transactions
  store, `saveTransaction` is the one place that does this, and only after a confirmed `204`; it
  bumps `revision`, so `filteredTransactions` and `categoryAssignment` recompute. Never replace
  the row object or the `value` array: PrimeNG resets the page to 1 whenever the bound array's
  identity changes while a filter is active, and `filteredValue` holds the same (cached proxy)
  references, so a replaced object would stay rendered stale.
- **No ag-Grid Enterprise licence** is why this table is on PrimeNG at all: ag-Grid Community
  cannot do tree data and the Enterprise tier is a paid licence this project does not have. PrimeNG
  21 replaced it. **Stay on PrimeNG 21** — it is MIT-licensed; PrimeNG 22 moved to the commercial
  PrimeUI model, so bumping past 21 is a licensing decision, not a routine version bump.
- **Column sizing** is available through the `options.autoSizeStrategy` (mirrors ag-Grid's): `fitGridWidth`
  (fills the container), `fitProvidedWidth` (fixed width), `fitCellContents` (cells are single-line,
  table scrolls). Sizing is done in pure CSS, not by measuring in JS. The transactions table uses
  `fitCellContents` with an 82rem floor.

## 4. Adding or removing a column

1. `TransactionRow` in `packages/shared/src/contracts/transactions.d.ts` (DB name and nullability
   as in the table).
2. `TRANSACTION_COLUMNS` in `umsatz.ts` — it is the `SELECT` list and the response's `columns`
   (no mapping — rows are returned as the driver delivers them).
3. One `DataTableColDef<TransactionRow>` entry in `transactions.store.ts` (the `transactionColumns`
   field), at its display position. If it is a lookup (account), use a `valueGetter` lambda; if it
   needs special formatting or rendering, add a `valueFormatter` and/or a `cellRenderer` name with
   a matching `appDataTableCell` template — only if the default dash text isn't enough. The header
   translation key in **both** `en.json` and `de.json`.
4. `testing/transaction-fixture.ts` (`transaction()`; `transactionsResponse()` derives its columns
   from it) and the specs that count columns/headers.
5. `docs/architecture.md` if the contract or behaviour described there changes.
6. Run `pnpm format:fix`, `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build`.
