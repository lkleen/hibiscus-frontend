---
name: transactions-table
description: Rules for the transactions table (Hibiscus `umsatz`) across backend, shared contract and frontend table. Use BEFORE adding, changing or removing anything about transaction columns, the `/api/transactions` route or repository, `TransactionRow`, or sorting/filtering/paging of the transactions table. Columns are served and displayed exactly as stored; the backend never modifies them; sorting, filtering and paging are client-side PrimeNG `p-table` features.
---

# Transactions table

The transactions table shows the `umsatz` rows of the Hibiscus database. The data is imported from
banks by the Hibiscus desktop client, and **what a column contains differs by account and over
time** (SEPA `EREF+/KREF+/SVWZ+` markers on one bank, structured purpose lines on another, a "flat"
`zweck` with empty `zweck2`/`zweck3` since a Hibiscus update in May 2026). Interpreting the values
would only be right for some rows, so this app does not interpret them.

Files: `packages/backend/src/repositories/umsatz.ts`, `packages/backend/src/routes/transactions.ts`,
`packages/shared/src/contracts/transactions.d.ts` (`TransactionRow`),
`packages/frontend/src/app/features/transactions/`.

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
- Write scope stays as in `docs/architecture.md`: only `umsatz.umsatztyp_id` is written
  (`PATCH /api/transactions/:id`). Bank-imported fields are never edited.

## 2. Columns are displayed exactly as stored (frontend)

- Show the value as it is in the DB. Presentation only: the empty-value dash, ISO date part,
  number formatting for `betrag`/`saldo`. No content interpretation, no parsing of `zweck` text,
  no picking "the best" of several columns for one cell.
- Only ids are resolved to what they identify: `konto_id` → the account's own columns, added as
  four plain columns (holder `name`, `bic`, `kontonummer`, `bezeichnung`) looked up from
  `GET /api/accounts` by `konto_id` (`konto.name` is the holder, the same on every account);
  `umsatztyp_id` → the category picker. The `konto_id` itself is not shown.
- Show every **meaningful** column (filled on real data, not an empty legacy column); omit
  never-filled ones (`empfaenger_name2`, `primanota`, `flags`, `addkey`, `txid`, `purposecode`,
  `mandateid`, `creditorid`), plus `id`, `checksum`, `customerref` (almost always `NONREF`) and
  `kommentar`.
- Header labels come from the translations (`en.json` and `de.json`), never from field names.
  Labels must stay true to the raw column (`Purpose 1/2/3`, not "Type"/"Purpose").

## 3. Sorting, filtering, paging: PrimeNG's `p-table`, not the backend

- Use `p-table`'s own features (column sort, column filters, the global filter, pagination), all
  client-side. The backend route does not sort, filter or page for the table's sake, and gains no
  `limit`/`offset`, filter or sort parameters on `GET /api/transactions`. The frontend does not
  re-implement any of this with hand-rolled state.
- Before writing any table code, follow the `angular-primeng-table` skill. Use `<app-data-table>`
  in `transactions.component.html` — it wraps PrimeNG's `p-table` with column-owned lambdas and
  raw rows. It follows the active theme through the CSS bridge in `src/styles/_primeng-table.scss`.
- The backend returns all rows, `ORDER BY id` only for a deterministic response; that is transport,
  not table behaviour. The table loads every row in one request (about 10,000 rows) and does all
  sorting/filtering/paging on that in-memory set.
- **Lookups are `valueGetter`s in column definitions, evaluated live; rows stay raw.** The four
  account columns and the category column use `valueGetter` lambdas to resolve `konto_id` and
  `umsatztyp_id` from the raw row. No `TransactionViewRow` — column definitions compute values live,
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
- A category change mutates the raw row's `umsatztyp_id` in place and then calls
  `dataTable().refresh()`; the category column's `valueGetter` picks up the new name live. Never
  replace the row object or the `value` array: PrimeNG resets the page to 1 whenever the bound
  array's identity changes while a filter is active, and `filteredValue` holds the same (cached
  proxy) references, so a replaced object would stay rendered stale.
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
3. One `DataTableColDef<TransactionRow>` entry in `transactions.component.ts`, at its display
   position. If it is a lookup (account/category), use a `valueGetter` lambda; if it needs
   special formatting or rendering, add a `valueFormatter` and/or a `cellRenderer` name with a
   matching `appDataTableCell` template — only if the default dash text isn't enough. The header
   translation key in **both** `en.json` and `de.json`.
4. `testing/transaction-fixture.ts` (`transaction()`; `transactionsResponse()` derives its columns
   from it) and the specs that count columns/headers.
5. `docs/architecture.md` if the contract or behaviour described there changes.
6. Run `pnpm format:fix`, `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build`.
