# Transactions views: tabbed list + "by category" (Hibiscus-style)

Persist as `docs/plans/20261004-transactions-views-accepted.md` once approved (then follow the
plan-mode lifecycle: `implementing` → `done`).

## Context

`/:locale/transactions` is a single `<app-data-table>`. The user wants several **views of the same
transactions**, as tabs that share one set of controls (account filter, search, period). Switching
tabs must **not refetch** anything. Tab 1 is today's list. Tab 2 aggregates the transactions by
category the way Hibiscus's "Umsätze nach Kategorien" does. Everything stays read-only.

Decisions made with the user:
- **Category assignment works like Hibiscus**: use the stored `umsatztyp_id`, and when it is NULL
  match each category's `pattern` dynamically. This is a deliberate, documented exception to the
  transactions-table skill's "never interpret" rule. It only drives grouping; displayed values stay
  raw.
- **Tree content**: the category tree with totals (sum, income, expenses, including subcategories)
  and the individual transactions as leaves.
- **Tabs are URL child routes**: `/:locale/transactions/list` and `/:locale/transactions/categories`.

## Hibiscus reference behaviour (verified against willuhn/hibiscus master)

**Assignment** (`UmsatzImpl.getUmsatzTyp`, `UmsatzTypImpl.matches`, `UmsatzTypUtil`, `VerwendungszweckUtil`):
1. A stored `umsatztyp_id` wins. If that id is not among the categories, the transaction counts as
   unassigned (Hibiscus's cache lookup returns null).
2. Otherwise, categories are tried in `ORDER BY COALESCE(nummer,''), name` order and the **first
   match wins**. A category matches when all of these hold:
   - **Type**: if `betrag != 0`, then not (`betrag < 0` and type = 1 income), and not
     (`betrag > 0` and type = 0 expense). Type 2/NULL accepts both signs.
   - **Account**: if the category's `konto_id` is set, it must equal the transaction's `konto_id`.
     If `konto_kategorie` is non-empty, it must equal the account's `kategorie` exactly.
   - **Pattern**: a blank pattern never matches. Fields tested: `zweck` = zweck+zweck2+zweck3
     concatenated with `""` (newlines removed), plus the trimmed values of `empfaenger_name`,
     `empfaenger_name2`, `empfaenger_konto`, `kommentar`, `art`, `purposecode`, `customerref`,
     `endtoendid`, `mandateid`, `creditorid`, and `id` (exact match only, non-regex path).
     - **Non-regex** (`isregex != 1`): lowercase everything. With Hibiscus's default
       `search.ignore.whitespace=true`, strip all whitespace from `zweck`, `name` and `name2`.
       Split the lowercased pattern on unescaped `,` (`(?<!\\),`), trim each term, drop empty
       terms, remove `\`, and strip whitespace from each term (skipping terms that become empty).
       A term matches when it is a substring of any field, or `id` equals the term.
     - **Regex**: case-insensitive **full match** (Java `matches()`, emulated as
       `^(?:pattern)$` with flag `i`). It is tested against every field and against
       `name name2 kto zweck kom art purp e2eid mid cid ref` joined with spaces. An invalid regex
       never matches. Hibiscus shows an error for it, and so does this view (see below); it is not
       a silent fallback.
3. **Tree** (`UmsatzTree`, `UmsatzTreeNode`): only categories that have transactions in the
   filtered set appear, plus their ancestors. There is always an "Unassigned" pseudo-node, even when
   it is empty. Categories flagged `FLAG_SKIP_REPORTS` (bit 1), or with such an ancestor, are left
   out together with their transactions (Hibiscus `isExcludedFromReports`). For each node, `betrag`,
   `einnahmen` and `ausgaben` are summed recursively over its subcategories. Subgroups come before
   transactions. Hibiscus columns: name, purpose, date, amount, note, account.

## Architecture

```
TransactionsComponent (shell, /:locale/transactions)    providers: [TransactionsStore]
├─ <app-tab-nav>  (shared, extracted from Settings)
├─ toolbar: <app-account-filter> · search input · <app-date-range-filter>   ← bound to the store
└─ <router-outlet>
   ├─ list        → TransactionsListComponent         (today's table)
   └─ categories  → TransactionsByCategoryComponent    (<app-data-table> tree mode)
```

- **`TransactionsStore`** (`features/transactions/transactions.store.ts`, `@Injectable()`, provided
  on the shell so child routes inject the same instance and it dies with the shell). It loads
  accounts, transactions and categories **once**, in its constructor, with `forkJoin`, so a tab
  switch never fetches. It holds the shared filter signals: `range`, `excludedAccountIds` and
  `search` (debounced by 300 ms, matching PrimeNG's `filterDelay`). It exposes:
  - `accountsById`, `transactionColumns` (the list's column definitions, moved here as-is because
    search needs them as well);
  - `rowFilter`: account + range + search, as one predicate (or `null`, as today);
  - `filteredTransactions`: `computed`, used by the category view;
  - `assignedCategory`: `computed` over **all** transactions, keyed by transaction id. It depends
    only on the data, never on the filters, so changing a filter never re-runs the matching.
- **Search moves out of the table.** Add a pure `quickFilterMatches(row, columns, query)` to the
  data-table package (`data-table.defaults.ts`). It does exactly what the table's quick filter does
  today: visible columns, `getQuickFilterText` falling back to the `valueGetter` value, and
  PrimeNG `contains` semantics (accent-stripped, locale-lowercased). Both tabs use it through
  `rowFilter`. The list's table sets `quickFilter: false`. This keeps one search, with identical
  hits in both tabs.
- **List tab**: today's template/columns/options, with
  `[value]="store.transactions()" [externalFilter]="store.rowFilter()"`. The toolbar slots are no
  longer projected (the shell owns the controls).
- **By-category tab**: builds `CategoryReportRow[]`, a discriminated union that *wraps* the raw
  rows and does not copy values:
  `{ kind: 'category', id: 'c<id>' | 'c-none', parentId, category: CategoryRow | null }` and
  `{ kind: 'transaction', id: 't<id>', parentId: 'c…', transaction: TransactionRow }`, built by a
  pure `buildCategoryReport()`. Tree options: `groupColId: 'name'`, `groupDefaultExpanded: 0`
  (Hibiscus opens collapsed, and fully expanding 10k leaves would be slow), `quickFilter: false`,
  and `filter: false` on every column (the filters are the shell's, and per-column tree filters
  would make the totals lie). Columns: name (category name / `empfaenger_name`), date, purpose
  1–3, amount (sum), income, expenses, account label. Default sort uses a hidden `order` column
  whose comparator puts categories (by `nummer ?? ''`, then `name`, unassigned last) before
  transactions (newest `datum`, then `id`, first). Invalid regex patterns are listed in a visible
  warning above the tree.
- **New generic data-table feature: `aggFunc: 'sum'`** on `DataTableColDef`, following ag-Grid's
  tree-data aggregation. In tree mode, a node **with children** shows and sorts by the sum of its
  descendant leaves' `valueGetter` values (nulls skipped), not its own value. It is computed once
  per `treeNodes` rebuild. Income and expenses are two sum columns whose getters return `betrag`
  only for positive or only for negative values. CLAUDE.md requires table features to live in
  the component, not in the feature.

## Phases

### Phase A — Contract + backend: serve the matching fields
- **Status:** done
- **Started:** 2026-10-04 19:56
- **Ended:** 2026-10-04 19:58

Add `kommentar`, `purposecode`, `customerref`, `mandateid` and `creditorid` (all `string | null`)
to `TransactionRow` (`packages/shared/src/contracts/transactions.d.ts`), to `TRANSACTION_COLUMNS`
(`packages/backend/src/repositories/umsatz.ts`) and its spec, and to `transaction()` in
`features/transactions/testing/transaction-fixture.ts`. They are served, not displayed.

### Phase B — Hibiscus category matcher (pure)
- **Status:** done
- **Started:** 2026-10-04 19:58
- **Ended:** 2026-10-04 19:59

`features/transactions/by-category/category-assignment.ts`:
`assignCategories({ transactions, categories, accountsById })` →
`{ byTransactionId: Map<number, CategoryRow | null>, invalidPatterns: CategoryRow[] }`.
It implements the reference behaviour above exactly: compile each pattern once, order the
categories once, first match wins. The spec covers each rule: stored id, unknown stored id,
type/sign including `betrag = 0`, `konto_id`, `konto_kategorie`, comma split with `\,` escape,
whitespace stripping, full-match regex, invalid regex, ordering, and the `id` exact match.

### Phase C — data-table: `aggFunc` + exported quick-filter matcher
- **Status:** done
- **Started:** 2026-10-04 19:56
- **Ended:** 2026-10-04 20:00

`data-table.model.ts` (`aggFunc?: 'sum'`, tree mode only; `validateTreeMode` throws on it outside
tree mode), `data-table-tree.ts` (aggregate per node key), `data-table.component.ts` (cell value
and tree sort use the aggregate on group nodes), and `quickFilterMatches` in
`data-table.defaults.ts`. The specs prove that it matches the table's own global-filter hits.
Update the data-table section in `docs/architecture.md`.

### Phase D — Shared tab nav + toolbar styles (UI: invoke `frontend-design` first)
- **Status:** done
- **Started:** 2026-10-04 19:56
- **Ended:** 2026-10-04 19:58

Extract Settings' tab bar into `shared/components/tab-nav/` (inputs: `tabs: {path, labelKey}[]`,
`basePath: string[]`, `ariaLabelKey`; markup and SCSS moved over from `settings.component.*`, with
token names generalised to `--tab-nav-*`). Settings uses it. Move the `.filters*` toolbar rules
from `data-table.component.scss` into a global partial `src/styles/_filter-bar.scss` (imported in
`styles.scss`), so the shell toolbar and the data table share them.

### Phase E — Shell, store, routes, list tab
- **Status:** done
- **Started:** 2026-10-04 19:58
- **Ended:** 2026-10-04 20:01

- `transactions-tabs.ts` (`TRANSACTIONS_TABS`, a single source like `SETTINGS_TABS`) and
  `transactions.routes.ts` (empty path redirects to the first tab). `app.routes.ts` switches the
  `transactions` route to `loadChildren`.
- `transactions.store.ts` as described above.
- The shell `transactions.component.*` becomes: visually-hidden h1, tab nav, toolbar, outlet, and
  the error message. It keeps today's `:host` flex-column layout, so `scrollHeight: 'flex'` still
  works in the children.
- `list/transactions-list.component.*`: today's table, moved. Move the existing
  `transactions.component.spec.ts` assertions to the list/store specs as appropriate.

### Phase F — By-category tab
- **Status:** done
- **Started:** 2026-10-04 20:01
- **Ended:** 2026-10-04 20:05

`by-category/category-report.ts` (`buildCategoryReport(filteredTransactions, assigned,
categories)` → rows; it applies the skip-reports exclusion, the ancestor closure, the always-present
unassigned node and the parent ids) plus its spec. `by-category/transactions-by-category.component.*`
holds the columns, options, the amount cell (reuse `AmountCellComponent`) and the invalid-pattern
warning.

### Phase G — i18n, docs, skill
- **Status:** done
- **Started:** 2026-10-04 20:01
- **Ended:** 2026-10-04 20:05

`en.json` and `de.json`: tab labels, tab-nav aria label, search label (reuse the `table.*` keys
where they fit), report column headers, `Unassigned`/`Nicht zugeordnet`, and the invalid-pattern
warning. `docs/architecture.md`: the transactions section (shell, tabs, store, shared controls,
category view, served matching columns). `.claude/skills/transactions-table/SKILL.md`: the served
but not displayed matching columns, and the documented category-assignment exception, scoped to
grouping only.

## Execution table

| Step | Agent | Model / effort | Wave | Write set | Reads |
|---|---|---|---|---|---|
| A | implementer-light | haiku / low | 1 | shared transactions.d.ts, backend umsatz.ts + spec, transaction-fixture.ts | transactions-table skill |
| B | implementer | sonnet / high | 2 | by-category/category-assignment.ts + spec | this plan's reference section, contracts |
| C | implementer | sonnet / high | 1 | shared/components/data-table/* (model, tree, component, defaults + specs) | angular-primeng-table skill |
| D | implementer | sonnet / medium | 1 | shared/components/tab-nav/*, settings.component.*, styles/_filter-bar.scss, styles.scss, data-table.component.scss | frontend-design skill, frontend.md |
| E | implementer | sonnet / medium | 3 | transactions.component.*, transactions.store.ts, transactions-tabs.ts, transactions.routes.ts, list/*, app.routes.ts | output of A–D |
| F | implementer | sonnet / high | 4 | by-category/category-report.ts + spec, by-category/transactions-by-category.component.* | B, C, E |
| G | implementer-light | haiku / medium | 4 | i18n/en.json, de.json, docs/architecture.md, transactions-table SKILL.md | all |

Wave 1 runs A, C and D in parallel (their write sets are disjoint; D touches only the data-table
scss, C only the ts/model). B follows A because it needs the new fields. E needs A, C and D; F
needs B, C and E.

## Race conditions

- The store loads in one `forkJoin`, so categories, accounts and transactions are always
  consistent when the views first compute. Filter signals are synchronous `computed`s, so there is
  no async ordering.
- The search debounce timer is cleared on destroy (`DestroyRef`).
- Leaving `/transactions` destroys the store, and coming back refetches. That is intended: only
  *tab* switches avoid refetching.

## Verification

1. Run `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build` from the
   repo root. Everything must be green with no warnings.
2. In the browser (`pnpm start:local`, Chrome tools):
   - `/de/transactions` redirects to `/de/transactions/list`, and the table looks as before.
   - Switch to "Nach Kategorien": the network panel shows **no** new `/api/*` request, and
     switching back doesn't either.
   - Account, search and period are applied in both tabs. Changing them in one tab persists in the
     other.
   - Spot-check against Hibiscus desktop's "Umsätze nach Kategorien" for the same period and
     account: the top-level categories and their sums must match, and so must the unassigned
     total.
   - Expand all and collapse all work, sorting by amount sorts categories by their totals, and
     dark mode plus every theme render the tab nav and toolbar correctly.

## Outcome

Gates: format, lint, 28 backend + 306 frontend tests and build pass. The only warning is the
pre-existing initial-bundle budget (652 kB vs 500 kB; was 629 kB before the PrimeNG migration).
The browser check (verification step 2) is still open because the Chrome extension was not
connected. The spot-check against Hibiscus desktop totals is left to the user.
