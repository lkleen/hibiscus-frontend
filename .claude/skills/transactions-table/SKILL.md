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

## 3. Sorting, filtering, paging: PrimeNG's `p-table`, not the backend

- Use `p-table`'s own features (column sort, column filters, the global filter, pagination), all
  client-side. The backend route does not sort, filter or page for the table's sake, and gains no
  `limit`/`offset`, filter or sort parameters on `GET /api/transactions`. The frontend does not
  re-implement any of this with hand-rolled state.
- Before writing any table code, follow the `angular-primeng-table` skill. There is **no** wrapper
  component (the deleted `BaseTableComponent`/`ag-dev` pattern) — `<p-table>` is used directly in
  `transactions.component.html`, and it follows the active theme through the CSS bridge in
  `src/styles/_primeng-table.scss`, not a component-level theme object.
- The backend returns all rows, `ORDER BY id` only for a deterministic response; that is transport,
  not table behaviour. The table loads every row in one request (about 10,000 rows) and does all
  sorting/filtering/paging on that in-memory set.
- **No `valueGetter`/`cellDataType` — looked-up values are materialised onto a view row instead.**
  PrimeNG's sort, column filters and global search only work on plain properties of the bound row,
  so `transactions.component.ts` builds a `TransactionViewRow` (`TransactionRow` plus the four
  looked-up account columns, `category_name`, and two filter-only `Date` fields — see below) in a
  `signal`/effect, not a `computed`. This does **not** license reinterpreting a DB value: it only
  *attaches* resolved lookups next to the untouched raw fields, and §1/§2 still bind — display and
  sort still use the raw stored value wherever one exists.
- Per-column filters are `<p-columnFilter type="text"|"numeric"|"date" display="row"
  filterOn="input">` in the template's second header row. `filterOn="input"` is required — v21
  defaults to `'enter'`, which would silently drop the as-you-type behaviour the old floating
  filters had.
- **The date-filter trap:** PrimeNG's `type="date"` filter renders a datepicker that emits a
  `Date`, and `FilterService` then calls `.toDateString()` on the cell value — which throws on the
  ISO date strings `GET /api/transactions` returns. So `datum`/`valuta` are filtered on the view
  row's `datum_date`/`valuta_date` (`Date | null`, parsed locally, filter-only), while the visible
  cell and the sort both keep the raw ISO string (lexicographic order is already chronological).
  Never point a date `p-columnFilter` at the raw string field.
- `[globalFilterFields]` must list every field the search box should reach, including the
  looked-up ones (`konto_name`, `category_name`, …) — PrimeNG only resolves own/nested properties
  of the row and throws if a listed field is absent. A new displayed column that should be
  searchable has to be added here too.
- A category change mutates the existing row **object** in place (same array, same object
  identity) rather than replacing it — PrimeNG resets the page to 1 whenever the `[value]` array's
  identity changes while a filter is active, and `filteredValue` (what renders while filtering)
  holds the same row references as the array, not copies, so replacing the object would leave a
  stale one rendered.
- **No ag-Grid Enterprise licence** is why this table is on PrimeNG at all: ag-Grid Community
  cannot do tree data and the Enterprise tier is a paid licence this project does not have. PrimeNG
  21 replaced it. **Stay on PrimeNG 21** — it is MIT-licensed; PrimeNG 22 moved to the commercial
  PrimeUI model, so bumping past 21 is a licensing decision, not a routine version bump.
- **Lost capability, no replacement:** ag-Grid's `autoSizeStrategy` (size-to-content, continuously
  re-fit) has no PrimeNG equivalent. Column sizing today is a `[tableStyle]` `min-width` hint plus
  plain browser table auto-layout — deliberately minimal, to be tuned once there's real usage to
  look at. Don't try to rebuild auto-sizing by hand; tell the user it isn't available.

## 4. Adding or removing a column

1. `TransactionRow` in `packages/shared/src/contracts/transactions.d.ts` (DB name and nullability
   as in the table).
2. The `SELECT` in `umsatz.ts` (the mapping stays absent — rows are returned as they come).
3. The column in `transactions.component.html` (a `<th pSortableColumn>` in the label row, a
   `<p-columnFilter>` in the filter row, a `<td>` in `#body`) and, if it is a looked-up value,
   `TransactionViewRow`/`buildViewRow`/`globalFilterFields` in `transactions.component.ts`.
   Translation keys in **both** `en.json` and `de.json`.
4. `testing/transaction-fixture.ts` and the specs that count columns/headers.
5. `docs/architecture.md` if the contract or behaviour described there changes.
6. Run `pnpm format:fix`, `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build`.
