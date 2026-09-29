# Columnar payload for `GET /api/transactions`

Status: done

## Context

`GET /api/transactions` sends ~10,000 `umsatz` rows as `TransactionRow[]`. Every object repeats all
17 column names (`"empfaenger_konto":`, `"umsatztyp_id":`, …), so the key strings make up a large
part of the payload. The goal is to send the column names **once** and each row as a plain array
of values in that column order:

```json
{
  "columns": ["id", "konto_id", "empfaenger_konto", …, "umsatztyp_id"],
  "rows": [[1, 3, "DE…", …, 7], [2, 5, null, …, null]]
}
```

The `transactions-table` skill still applies. Values stay exactly as stored and keep their DB column
names. Only the transport shape changes. The frontend turns the payload back into raw
`TransactionRow` objects in `ApiService`, so the table, the column definitions (`valueGetter`s), the
in-place category mutation and every component spec stay unchanged.

## Design

### Shared contract (`packages/shared/src/contracts/transactions.d.ts`)
Add these next to `TransactionRow`. Nothing is declared a second time.
```ts
export type TransactionColumn = keyof TransactionRow;
export type TransactionValue = TransactionRow[TransactionColumn];

/** Response of `GET /api/transactions`: column names once, each row as values in `columns` order. */
export interface TransactionsResponse {
  columns: TransactionColumn[];
  rows: TransactionValue[][];
}
```
The package stays types-only, so no runtime code goes into `shared`.

### Backend: `packages/backend/src/repositories/umsatz.ts`
- A single typed column list is the source of truth for both the `SELECT` and `columns`:
  `const TRANSACTION_COLUMNS: TransactionColumn[] = ['id', 'konto_id', …, 'umsatztyp_id'];`
  (the current 17 columns, in the same order). Build the SQL from it with
  `` `SELECT ${TRANSACTION_COLUMNS.join(', ')} FROM umsatz ORDER BY id` ``. The names are
  compile-time literals, so there is no injection surface.
- Use mysql2's `rowsAsArray: true` query option
  (`pool.query<TransactionValue[][] & RowDataPacket[][]>({ sql, rowsAsArray: true })`). The driver
  returns each row as an array in `SELECT` order, so the backend does no per-row mapping. Values
  come back exactly as the driver delivers them.
- Rename to `listTransactions(): Promise<TransactionsResponse>`, returning
  `{ columns: TRANSACTION_COLUMNS, rows }`.

### Backend: `packages/backend/src/routes/transactions.ts`
- `res.json(response)` with the `TransactionsResponse` type. The existing comment stays as it is.

### Frontend: `packages/frontend/src/app/core/services/api.service.ts`
- `getTransactions(): Observable<TransactionRow[]>` keeps its signature. It fetches
  `TransactionsResponse` and uses `map` to turn the payload back into rows through a small pure
  function, `toTransactionRows(response)`. That function is private to the file, or exported for
  the spec: for each value array it runs
  `Object.fromEntries(columns.map((c, i) => [c, values[i]]))`, typed as `TransactionRow`.
  The one cast is documented at that single spot: the column list and the value order are both
  guaranteed by the backend contract.
- It throws when a row's length differs from `columns.length`. That follows the no-silent-failure
  rule: a malformed payload is an error, not a partial row.
- `transactions.component.ts` needs no changes, since it still receives `TransactionRow[]`.

### Docs
- `docs/architecture.md`: update the API table row and the "Transactions table" and "Shared
  contracts" paragraphs to describe the columnar response and where it's turned back into rows
  (`ApiService`).
- The `transactions-table` skill (§1, §4): §1 says "no mapping function between row and response".
  Add that the response is columnar (`columns` + value arrays, via `rowsAsArray`), that values and
  names are still as stored, and that adding a column now means adding it to `TRANSACTION_COLUMNS`
  instead of a raw `SELECT` list.

## Steps

(Executed inline rather than by subagents: the change was small enough that spawning would have
cost more than it saved.)

Persist this plan first as `docs/plans/20260929-columnar-transactions-payload-accepted.md` with the
phase template (status and start/end timestamps), then rename it through `implementing` and `done`.

### Phase A: Contract + backend (sonnet)
- **Status:** done
- **Started:** 2026-09-29 22:39
- **Ended:** 2026-09-29 22:41

Shared types, `umsatz.ts` (`TRANSACTION_COLUMNS`, `rowsAsArray`), route. Update `umsatz.spec.ts`:
- the query is called with `rowsAsArray: true` and the SQL still has no `WHERE`/`LIMIT`
- `columns` equals the selected column list, in `SELECT` order
- `rows` is exactly the array the driver returned (`toBe`)

### Phase B: Frontend decode (sonnet), after A for the types
- **Status:** done
- **Started:** 2026-09-29 22:41
- **Ended:** 2026-09-29 22:43

`ApiService.getTransactions` plus `api.service.spec.ts`:
- flushing a columnar payload yields the expected `TransactionRow` objects
- a length mismatch throws
- still no query params
`transactions.component.spec.ts` flushes `items` as objects at line 72. Change it to flush the
columnar form, through a tiny helper in `testing/transaction-fixture.ts` that builds a
`TransactionsResponse` from fixture rows.

### Phase C: Docs (haiku)
- **Status:** done
- **Started:** 2026-09-29 22:46
- **Ended:** 2026-09-29 22:48

`docs/architecture.md` and the `transactions-table` skill, as described above.

## Verification
- From the repo root: `pnpm format:fix`, `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build`.
  All must pass without warnings.
- Run `pnpm start:local` and open the transactions page. Check that the rows, the account and
  category columns, sort, filters, search and a category change all still work. In DevTools, compare
  the `/api/transactions` response size before and after the change.

## Result

Measured on the local DB (9,965 rows): 4,625 KB → 2,757 KB raw (−40%); gzip 617 KB → 528 KB.
The `pnpm build` initial-bundle budget warning (~630 kB of 500 kB) predates this change
(629.95 kB before it).

## Note (not part of this change)
Express currently sends responses **uncompressed** (`server.ts` has no `compression`). gzip would
shrink the repeated keys almost as well, and would also cover the value text. Adding it means adding
a dependency, or letting the fronting proxy compress. That's a separate decision.
