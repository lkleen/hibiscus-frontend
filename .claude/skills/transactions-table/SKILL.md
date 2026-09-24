---
name: transactions-table
description: Rules for the transactions table (Hibiscus `umsatz`) across backend, shared contract and frontend grid. Use BEFORE adding, changing or removing anything about transaction columns, the `/api/transactions` route or repository, `TransactionRow`, or sorting/filtering/grouping/paging of the transactions grid. Columns are served and displayed exactly as stored; the backend never modifies them; sorting, filtering and grouping are ag-Grid features.
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
- **Never** derive, merge, split, parse, trim, normalise, default or fix a column value
  (no "combine `zweck` + `zweck2` + `zweck3`", no "fall back to `zweck` when `empfaenger_name` is
  NULL", no repairing the broken umlauts in `art`). If a value looks wrong, it is shown wrong.
- `TransactionRow` (shared package) mirrors the selected columns one-to-one and is declared once;
  the backend types its query result as `TransactionRow & RowDataPacket`, the frontend imports the
  same type. Never re-declare it, never add a second "view model" type for the API.
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

## 3. Sorting, filtering, grouping, paging: ag-Grid, not the backend

- Use ag-Grid's own features (column sort, column filters, row grouping, pagination). The backend
  route does not sort, filter or group for the table's sake, and the frontend does not
  re-implement them with `valueGetter`s, hand-rolled state or extra API parameters.
- Before writing any grid code load the `ag-dev` skill, and follow `angular-ag-grid-table` (every
  table goes through `BaseTableComponent`). Register new ag-Grid modules in
  `base-table.component.ts`.
- **Enterprise features are not an option** (user decision): no `ag-grid-enterprise`. That rules
  out row grouping (Enterprise-only) and the server-side row model; stay on the Community client-side
  row model with its sort, filter and pagination. Do not build a substitute for row grouping by
  hand — tell the user it is not available.
- The backend returns all rows, `ORDER BY id` only for a deterministic response; that is transport,
  not table behaviour.
- Columns that show something other than the raw value (the account columns and the category, both
  looked up) get a `valueGetter`, so ag-Grid sorts and filters what the user sees.
- Give every column an explicit `cellDataType` (`text`, `number`, `dateString` for the ISO date
  strings) — ag-Grid picks the matching filter and formatting from it.

### How it works today

The table loads every row in one request (about 10,000 rows) and the Community client-side row
model does the rest: default sort `datum` desc (with a hidden `id` column as tie-break, both
`initialSort`), floating filters (`filter: true` picks text/number/date by `cellDataType`), the
quick filter (`quickFilterText`, fed by the search field), and the built-in pagination panel. The
grid's own texts are translated through the `grid.*` dictionary keys
(`core/utils/grid-locale-text.ts`); add a key there when a new grid feature shows new text. A
changed category is applied with `api.applyTransaction` so page, sort and filters stay. Keep it
that way: no `limit`/`offset`, filter or sort parameters on `GET /api/transactions`.

## 4. Adding or removing a column

1. `TransactionRow` in `packages/shared/src/contracts/transactions.d.ts` (DB name and nullability
   as in the table).
2. The `SELECT` in `umsatz.ts` (the mapping stays absent — rows are returned as they come).
3. The column definition in `transactions.component.ts` (`text(...)` helper for text columns) and
   translation keys in **both** `en.json` and `de.json`.
4. `testing/transaction-fixture.ts` and the specs that count columns/headers.
5. `docs/architecture.md` if the contract or behaviour described there changes.
6. Run `pnpm format:fix`, `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build`.
