# Generic table component: `<app-data-table>`

## Context

The transactions template (`features/transactions/transactions.component.html`, 294 lines)
hand-writes 18 columns three times each (a sortable `<th>`, a `<p-columnFilter>`, a `<td>`).
`transactions.component.ts` builds a hand-made `TransactionViewRow` because PrimeNG has no
`valueGetter`. The current rules forbid a wrapper around `p-table`.

The user wants the opposite:
- **One generic table component, mandatory for every table.**
- **Tables gain features by extending the generic component, never per feature.** Its API must be
  generic enough to cover every use case the project implements.
- **Every feature can be switched off**, and its default behaviour is a **lambda that a custom
  lambda can replace**.
- **The ag-Grid API is the design reference:** `ColDef` with `valueGetter`, `valueFormatter`,
  `comparator`, `filter`, `filterValueGetter`, `getQuickFilterText`, `cellRenderer`, and a grid
  API with `refreshCells`.

Scope decisions:
- Rules change in the generic skill (claude-config) and in the project files.
- The search box (global filter) belongs to the component.
- It is a pure structural refactor: the rendered output and theming stay identical.

### Verified PrimeNG 21 mechanics the design relies on

(Checked in `node_modules/primeng/fesm2022`.)
- **Sort:** with `customSort` enabled, `(sortFunction)` hands sorting to the component, so the
  column's `comparator` is applied to `valueGetter` results.
- **Global filter:** `globalFilterFields` entries go through `ObjectUtils.resolveFieldData`, which
  **calls the entry if it is a function**. The column's `getQuickFilterText` lambda can therefore
  be passed directly.
- **Column filter:** the field is the filter-map **key**, which is always a string, and the value
  is read as `row[key]` (`executeLocalFilter`). This is the one place where no function can be
  passed, which is why the proxy below exists.

## Core design (decided): raw rows, column-owned lambdas, a column-accessor proxy

Rows stay **raw data**. Everything computed belongs to the **column** (`valueGetter`,
`valueFormatter`, `comparator`, `filterValueGetter`, `getQuickFilterText`) and is evaluated **live
when requested**. Nothing is stored on or next to the row. This is ag-Grid's model.

- Sorting and the global filter call the column lambdas directly (see above).
- **Column filters use a column-accessor proxy.** `p-table` binds to one read-only `Proxy` per raw
  row. It is cached in a `WeakMap<Row, Proxy>`, so object identity stays stable and PrimeNG's
  `filteredValue` and paging keep working.
  - Its `get` trap answers a filter key (`colId`) by calling that column's `filterValueGetter`.
  - Every other key goes to the raw row.
  - The `set` trap throws, because the table never writes.
  - A block comment in the component explains why the proxy exists (PrimeNG reads column filters
    as `row[key]` only) and that it is the only place PrimeNG internals are relied on. PrimeNG 21
    is pinned.
- The bound proxy array is a `computed` over `value`, so it is a new array only when the feature
  passes a new `value`. Proxies are reused from the `WeakMap`.
- Cell templates and every lambda receive the **raw row** (the proxy target), never the proxy.
- **No `refreshRows`, no materialisation.** Values are computed live, so a feature that mutates
  a raw row in place (the category change) only has to trigger change detection. The component
  exposes `markForCheck()`-style `refresh()`, like ag-Grid's `refreshCells()`, only to repaint.
- **`datum_date` goes away.** A column with `filter: 'date'` gets the default
  `filterValueGetter` (`parseIsoDate` of the value), and PrimeNG receives a `Date`. The row keeps
  only the ISO string. `TransactionViewRow` and `buildViewRow` are removed; the account and
  category lookups become `valueGetter` lambdas in the column definitions.
- Race/perf check: all lambdas are synchronous and pure. Filtering 10k rows × a few filtered
  columns means a few tens of thousands of getter calls per keystroke, which is fine. Sorting
  calls `valueGetter` O(n log n) times; if profiling shows this matters, cache per sort run inside
  `onSort` (a local `Map`, dropped afterwards), never on the row.

## API (ag-Grid-shaped; each feature can be switched off and each default is a replaceable lambda)

`data-table.model.ts`:
```ts
export interface DataTableColDef<Row, Value = unknown> {
  readonly colId: string;                                          // unique; also the proxy's filter key
  readonly headerKey: TranslationKey;
  readonly valueGetter?: (row: Row) => Value;                      // default: row[colId]
  readonly valueFormatter?: (value: Value, row: Row) => string;    // default: dashFormatter
  readonly cellRenderer?: string;                                  // name of an appDataTableCell template
  readonly sortable?: boolean;                                     // default true
  readonly comparator?: (a: Value, b: Value, isDescending: boolean) => number; // ascending result; default: defaultComparator
  readonly filter?: DataTableFilterType | false;                   // 'text' | 'numeric' | 'date'; default 'text'
  readonly filterValueGetter?: (row: Row) => unknown;              // default: per filter type (date → parseIsoDate)
  readonly getQuickFilterText?: (value: Value, row: Row) => unknown; // default: the raw value (not formatted)
  readonly hide?: boolean;                                         // ag-Grid `hide`: not rendered, not searched, still sortable (e.g. an id tie-break)
  readonly align?: 'start' | 'end';
}
export interface DataTableSortModel { readonly colId: string; readonly order: 1 | -1 }
export interface DataTableOptions<Row> {                           // every key optional; defaults in DEFAULT_TABLE_OPTIONS
  readonly pagination?: false | { readonly pageSize: number; readonly pageSizes: readonly number[] };
  readonly quickFilter?: false | { readonly matcher?: (text: string, query: string) => boolean };
  readonly defaultSort?: readonly DataTableSortModel[];
  readonly striped?: boolean;
  readonly scrollHeight?: string | false;
  readonly minWidth?: string;
  readonly emptyKey?: TranslationKey;
  readonly getRowId: (row: Row) => string | number;               // required, like ag-Grid
}
```
- **Behaviour parity (added at implementation start, from the PrimeNG 21 source):**
  - `defaultComparator` mirrors `ObjectUtils.sort(v1, v2, order, undefined, 1)` from
    `primeng-utils.mjs`, which is what `sortMode="multiple"` uses today. Empty values
    (`ObjectUtils.isEmpty`) go last in **both** directions; strings use
    `localeCompare(b, undefined, { numeric: true })`; everything else uses `<`/`>`. Multi-sort
    tie-breaking works like `multisortField`: move to the next sort key when the compare is 0.
    With `customSort`, the `(sortFunction)` handler sorts `event.data` **in place**.
  - Quick filter: by default the global filter uses PrimeNG's own `'contains'` matchMode, applied
    to the raw value, which is what happens today. A custom matchMode is registered on the
    component-provided `FilterService` only when `quickFilter.matcher` is set.
- Default lambdas (`dashFormatter`, `defaultComparator`,
  `parseIsoDate`, `containsMatcher`, and the per-type filter value getters) live in
  `data-table.defaults.ts`. They are exported so a custom lambda can compose with a default.
- Only what the project uses today is built. New features are added **to this API** (a new option
  or column property, with a default lambda and an off switch), never around it in a feature.

## Phase A — Adapt the rules (generic + project)

- `../claude-config/skills/angular-primeng-table/SKILL.md` §5: replace "Do not wrap `p-table`…"
  and the optional-directive subsection with a new subsection, "One generic table component
  (mandatory)":
  - Every flat table goes through one project-owned generic table component. Feature templates
    never contain `<p-table>`.
  - Features are added to the component, never implemented per table on top of it. The component
    grows until it covers every use case the project has.
  - Every feature can be switched off, and its default behaviour is a lambda that the caller can
    replace with a custom one.
  - Model the API on ag-Grid's `ColDef`/`GridOptions`/grid API (name the concepts above). It uses
    a curated set of inputs, never forwarded `p-table` inputs.
  - Rows stay raw, and computed values belong to the column (lambdas evaluated live). Never
    materialise column values onto rows or view rows.
  - Include the verified PrimeNG mechanics (`customSort` → comparator, function entries in
    `globalFilterFields`, the column-accessor proxy for column filters) so the next project
    doesn't have to rediscover them.
  - Theming stays the CSS bridge. TreeTable gets a sibling generic component once it is needed.
- `CLAUDE.md` ("Tables are PrimeNG"): every table uses `<app-data-table>`
  (`app/shared/components/data-table/`), features go into the component, and there is no
  `<p-table>` in feature templates.
- `docs/architecture.md`: the frontend package bullet and the "Transactions table" section.
- `.claude/skills/transactions-table/SKILL.md` §3/§4:
  - "No `valueGetter`" becomes "lookups are `valueGetter`s in the column definitions, evaluated
    live; rows stay raw". `TransactionViewRow` is removed.
  - The date-filter trap is now handled by the default `filterValueGetter` for `filter: 'date'`
    (through the proxy). There is no `datum_date` any more.
  - `globalFilterFields` is no longer maintained by hand.
  - `applyCategory` mutates the raw row in place and then calls `dataTable().refresh()`.
  - Adding a column means adding one `DataTableColDef` entry.
  - §1/§2 still apply: a `valueGetter` may only resolve ids and must never reinterpret stored
    values.

## Phase B — Build the component

`packages/frontend/src/app/shared/components/data-table/`:
- `data-table.model.ts`, `data-table.defaults.ts` (see above).
- `data-table-cell.directive.ts`: `ng-template[appDataTableCell]` takes the renderer name, and a
  typed `ngTemplateContextGuard` provides the context `{ $implicit: Row; value; valueFormatted }`,
  like ag-Grid's `ICellRendererParams`.
- `data-table.component.ts`: `OnPush`, generic `<Row>`.
  - Inputs: `value` (required), `columns` (required), `options` (required, for `getRowId`),
    `loading`.
  - It keeps the `WeakMap<Row, Proxy>` and a `boundRows` `computed` over `value` (see Core
    design), and exposes `refresh()` (`markForCheck`).
  - The column-accessor proxy lives in its own small file, `column-accessor-proxy.ts`, with a
    unit spec: filter keys go to `filterValueGetter`, other keys to the raw row, and a `set`
    throws.
  - `globalFilterFields` is a `computed` giving one function per searchable column,
    `(proxy) => getQuickFilterText(valueGetter(raw), raw)`. The search box calls `filterGlobal`
    with a matchMode that runs `quickFilter.matcher`. That matchMode is registered on a
    **component-provided** `FilterService`, so nothing global is touched.
  - `onSort` applies the `comparator` lambda for each sort column to `valueGetter` results on the
    raw rows.
  - When `columns` changes (for example when lookups finish loading), nothing is rebuilt. Values
    are live, so a repaint is enough.
  - Also here: the translated page report (`table.pageReport`, keeping the `{first}` trick), the
    `dash` default, and the `contentChildren` map from renderer names to templates.
- `data-table.component.html`: the search form (when `quickFilter` is not false), then `<p-table>`
  with `customSort`, pagination/striped/scroll taken from the options, and the header, filter and
  body rows as `@for` loops over `columns()`. A column with `filter: false` gets an empty filter
  cell. `sortable: false` omits `pSortableColumn`. The empty message spans
  `colspan = columns().length`.
- `data-table.component.scss`: move `.filters*` and the table spacing out of
  `transactions.component.scss`. Rename them to `.data-table*`, and make `__col--end` the
  alignment class. `.transaction-table__amount*` stays as it is (the amount cell's contract with
  the theme files).
- i18n in **both** `en.json` and `de.json`: move `filterSearch`, `searchPlaceholder` and
  `pageReport` from `transactions.*` to `table.*`.

## Phase C — Migrate transactions

- `transactions.component.ts`:
  - Remove `TransactionViewRow`, `buildViewRow`, `parseIsoDate` (it moves to defaults), the table
    constants, `globalFilterFields`, `q`, `onSearchInput`, `dash`, `pageReportTemplate` and the
    `rows` effect.
  - `items` (the raw `TransactionRow[]`) is bound directly.
  - `columns = computed<DataTableColDef<TransactionRow>[]>` with 18 entries in the same order and
    with the same header keys. The four account columns and `category` use `valueGetter` lambdas
    over `accountsById()`/`categoriesById()`. `betrag`/`saldo` use `cellRenderer: 'amount'` and
    `align: 'end'`. `category` uses `cellRenderer: 'category'` and sorts/filters on the name.
    `datum`/`valuta` use `filter: 'date'`. A hidden `id` column (`hide: true`, `filter: false`)
    carries the default sort tie-break: `defaultSort = [{colId:'datum',order:-1},{colId:'id',order:-1}]`.
  - `applyCategory`: mutate `row.umsatztyp_id` on the raw row, then call `dataTable().refresh()`.
    The category column's `valueGetter` picks the new name up live.
- `transactions.component.html`: the `<h1>`, `<app-data-table>` with two cell templates
  (`amount`, `category`), and the error text.

## Phase D — Tests

- New `data-table.component.spec.ts`, using a host component with a toy row type. It covers:
  - headers;
  - the default dash and a custom `valueFormatter`;
  - a `valueGetter` feeding display, sort, filter and search;
  - a custom `comparator`;
  - `filter: false` and `sortable: false`;
  - the date `filterValueGetter`;
  - a custom quick-filter matcher and `quickFilter: false`;
  - `pagination: false`;
  - an in-place mutation of a raw row plus `refresh()` shows up while filtered, the table stays
    on the same page, and the bound array and proxy identities are unchanged;
  - no row ever receives a computed property (assert the raw rows' keys afterwards);
  - a cell renderer with its context.
- `transactions.component.spec.ts`: keep every existing test. Update only the CSS selectors
  (`transaction-table` → `data-table`) and the moved i18n keys. The test at spec line 360
  (category change while filtered) guards the refresh contract.

## Execution — subagents (the main session coordinates only)

| Step | Agent · model | Runs | Scope |
|------|---------------|------|-------|
| 0 | main session (claude-in-chrome) | before anything else | **Visual baseline.** Start `pnpm start:local`, open a new Chrome tab on `/de/transactions` and `/en/transactions`, and screenshot a fixed matrix: 5 themes × light/dark, plus the states "search active", "a column filter active", "date filter active" and "page 2". Save the list of states and screenshot IDs to the scratchpad so step 4 can repeat exactly the same states |
| 1a | general-purpose · **haiku** | in parallel with 1b | Phase A: rewrite the rules text from the bullet list above (the content is fully specified) |
| 1b | general-purpose · **sonnet** | in parallel with 1a | Phase B: the generic component, model, defaults, directive, SCSS, i18n (needs design judgement: generics, the column-accessor proxy, PrimeNG hooks) |
| 2a | general-purpose · **sonnet** | after 1b, in parallel with 2b | Phase C: move transactions over (valueGetter lookups, in-place mutation plus `refresh()`) and update the selectors and keys in `transactions.component.spec.ts` |
| 2b | general-purpose · **haiku** | after 1b, in parallel with 2a | Phase D: `data-table.component.spec.ts` against the API that 1b built |
| 3 | main session | after 2a and 2b | Review the diffs, run `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build`, and grep for `<p-table` (only `shared/components/data-table/` may contain it). On failure, send the error back to the agent that owns the file via SendMessage; move a haiku step up to sonnet only if it cannot fix it |

Every brief includes:
- the relevant plan section;
- the project rules (OnPush, `input()`, explicit types, no `any`, max 3 params, no barrels, fail
  loudly rather than defensively);
- "do not commit";
- "PrimeNG is v21: verify against `node_modules/primeng/types/primeng-table.d.ts` and the
  `fesm2022` source, not v22 docs".

**Step 4 — visual regression (main session, claude-in-chrome), after step 3:** repeat the step-0
matrix state by state and compare each pair of screenshots.
- Also check interactions: sorting by clicking a header, a category change while filtered (the
  row updates and the page stays), greenbar stripes and the amount styles per theme.
- Any visible difference is a regression. Send it back to the owning agent (1b for
  component/SCSS, 2a for transactions) and repeat step 4 until the screenshots match.

**frontend-design plugin:** invoke it only where a visual decision actually comes up. Examples: a
difference that cannot be fixed without choosing a new look, or a new control that the refactor
adds (such as a search field shown/hidden state that did not exist before). The target is
identical visuals, so it is not invoked for the pure refactor itself.

## Plan file of record

Per `plan-mode.md`, persist this plan as `docs/plans/20260928-generic-table-component-accepted.md`
with the phase template (Status / Started / Ended). Rename it through `-implementing` to `-done`
as the phases complete.

## Phase tracking

### Step 0 — Visual baseline
- **Status:** done
- **Started:** 2026-09-28 20:27
- **Ended:** 2026-09-28 20:55

The baseline is a computed-style/layout/text fingerprint (not class-name based) of the /de and /en
theme matrix, plus the search, text filter, page 2 and sort states. Stored in the session
scratchpad as `baseline.md`/`fingerprint.js`. The date filter could not be scripted (datepicker)
and is covered by the spec test instead.

### Phase A — Adapt the rules
- **Status:** done
- **Started:** 2026-09-28 20:56
- **Ended:** 2026-09-28 21:05

Review fixes: the component wraps `p-table` by composition (it does not subclass it); the in-place mutation rationale restored; the filter bullet now points at the column `filter` type.

### Phase B — Build the component
- **Status:** done
- **Started:** 2026-09-28 20:56
- **Ended:** 2026-09-28 21:40

Review round: the comparator returns the ascending result and the table applies direction (ag-Grid contract); `emptyKey` is required in the type; `containsMatcher` removes accents like PrimeNG's `contains`. Open: replace the template `$any(globalFilterFields())` with a documented typed cast in the component class.

### Phase C — Migrate transactions
- **Status:** done
- **Started:** 2026-09-28 21:25
- **Ended:** 2026-09-28 22:05

Review round: hidden columns carry no `headerKey` (union type); `asAmount` throws on a non-number; `columns` is a plain field.

### Phase D — Tests
- **Status:** done
- **Started:** 2026-09-28 21:41
- **Ended:** 2026-09-28 22:30

The haiku draft had assertions that didn't exercise the feature. The date-filter and custom-matcher tests were escalated to sonnet and are now proven to fail when the feature is broken.

### Step 3/4 — Quality gate and visual regression
- **Status:** done
- **Started:** 2026-09-28 22:00
- **Ended:** 2026-09-28 22:35

Gate: format, lint, 98 frontend and 10 backend tests, and build all pass. The only warning is the bundle budget (629.68 kB of 500 kB), which was already there before this change (629.31 kB).
Visual: all 10 `/de` theme × mode fingerprints and all `/de` states (base, search, text filter, page 2, sort by amount) are identical to the baseline.
`/en`: the dark variants and default light are identical. The four non-default light variants couldn't be compared with the original baseline, because it measured them before their web fonts had loaded. Resolved afterwards by serving the pre-refactor `HEAD` from a temporary git worktree on :4300 next to the refactor on :4200 and fingerprinting both in the same tab with fonts loaded: all 10 `/en` theme × mode fingerprints are identical.
Date filter checked in the app through the table API: 3 of 3 expected rows, and raw rows untouched (17 own keys, ISO strings).
The category change was not exercised in the browser, because it writes to the real database; it is covered by the transactions spec.
