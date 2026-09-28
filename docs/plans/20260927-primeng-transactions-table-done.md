# Migrate the transactions table from ag-Grid to PrimeNG

- **Status:** done
- **Supersedes:** `20260924-transactions-ag-grid-done.md` — that plan built this table on
  ag-Grid Community; this one replaces the library while keeping the data contract intact.

## Context

`hibiscus-frontend` renders exactly one data table — the transactions grid — on ag-Grid
Community via a shared `BaseTableComponent` (an `AgGridAngular` subclass that injects the
project theme). ag-Grid Community cannot do tree data, and its Enterprise tier is a paid
licence, so the project is switching its table library to PrimeNG. Because transactions is
the *only* table, this retires ag-Grid from the app entirely.

Two decisions are being recorded at the same time: the project's table-library choice goes
into `CLAUDE.md` (the `angular-primeng-table` skill requires the choice to live there), and
the `transactions-table` skill — which currently mandates ag-Grid — is rewritten.

PrimeNG 21 is the correct version: `@angular/core ^21` pairs with `primeng@21`
(`primeng@22` peers Angular 22), and **21 is MIT-licensed** while 22 moved to the
commercial PrimeUI model. Staying on 21 keeps this licence-free; a later 22 bump is a
procurement decision, not a version bump.

### Decisions taken (user, 2026-09-27)

1. **Remove ag-Grid fully** — deps, `BaseTableComponent`, `grid-locale-text.ts`, the 30
   `grid.*` i18n keys, and the `ag-dev`/`ag-update`/`angular-ag-grid-table` skill symlinks.
2. **Looked-up columns become a frontend view row** — account fields and category name are
   materialised as plain properties so PrimeNG's sort/filter/global-search work on them.
3. **Column sizing stays minimal** — a `min-width` table hint and browser auto-layout; tune
   after seeing real data. ag-Grid's `autoSizeStrategy` has no PrimeNG equivalent at all.
4. **Install the PrimeNG plugin + MCP server, pinned to v21.**

### Constraints discovered during research (these drive the design)

- **`type="date"` column filters cannot read ISO date strings.** PrimeNG's date filter
  renders a datepicker and emits a `Date`; `FilterService` then calls
  `value.toDateString()`, which throws on a string. → the view row carries real `Date`
  properties for the two date columns, used *only* as the filter field; display and sort
  keep the raw ISO string (lexicographic order is already chronological).
- **`globalFilterFields` only resolves own/nested properties** and throws if absent. → it
  must explicitly list every displayed field, which the view row makes possible.
- **A new `[value]` array identity resets the page to 1 while any filter is active**
  (`_filter()` sets `first = 0`). → the category update mutates the existing array in place
  instead of rebuilding it, so no `ngOnChanges` fires.
- **`filterOn` defaults to `'enter'` in v21** → set `filterOn="input"` to keep today's
  as-you-type feel.
- **The paginator report and the empty message are not keyed translations** →
  `currentPageReportTemplate` gets a localised string we bind, and the empty row uses the
  existing `status-text` markup.
- Use the **named template form** (`<ng-template #header>`), not legacy `pTemplate`.

## Delegation

Planning stays here; **the implementation phases run on Sonnet 5 subagents**
(`Agent` with `model: "sonnet"`). Phases are grouped so that **no two agents in the same
wave touch the same file** — the overlaps that force the grouping are noted below.

| Wave | Agent | Phases | Owns these files |
| ---- | ----- | ------ | ---------------- |
| 1 | *(no agent — run here)* | B, A | CLI installs need approval; `CLAUDE.md`, `docs/plans/…` |
| 2 | **setup-i18n** | C + G | `app/app.config.ts`, new `core/utils/primeng-translation.ts`, `i18n/en.json`, `i18n/de.json`, delete `core/utils/grid-locale-text.ts` |
| 2 | **theming** | D | `styles/_primeng-table.scss` (new), `styles.scss`, `styles/_theme-greenbar.scss` |
| 2 | **table** | E + F | everything under `features/transactions/` except `*.spec.ts` |
| 3 | **tests** | I | `features/transactions/**/*.spec.ts` |
| 3 | **cleanup** | H | delete `core/components/base-table/`, `packages/frontend/package.json`, `.claude/skills/*` links, `transactions-table/SKILL.md`, `docs/architecture.md` |
| 4 | *(no agent — run here)* | Verification | — |

Why these groupings: C and G both write the translation util; B and H both edit
`package.json`; F and I both touch the cell tests and the fixture — so each pair is one
agent or one wave apart. Wave 3 must start only after all of wave 2 has landed, because the
tests assert the new markup and the cleanup deletes what wave 2 replaces.

**Briefing each agent** (Sonnet needs this spelled out, not inferred):

- The relevant constraints from *Constraints discovered during research* above — especially
  the in-place array mutation, the ISO-string date-filter trap, `filterOn="input"`, and the
  named `<ng-template #header>` form. An agent that has to rediscover these will get them
  wrong.
- House conventions: `OnPush` + `input()`/`output()` + `inject()`, no `ngClass`/`ngStyle`,
  design tokens only (never a raw colour), `transaction-table__*` BEM names, `—` for empty
  values, i18n through `i18n.t()` with keys added to **both** `en.json` and `de.json`.
- The theme contract classes `transaction-table__amount--negative|--positive` and the dual
  signed/parenthesised amount DOM are styled by four theme files — they must survive
  byte-identical.
- Tell each agent to use the **PrimeNG MCP server** (`@primeng/mcp@v21-stable`) for API
  questions and that the public docs describe v22, so v21 differences must be checked
  against `node_modules/primeng/types/`.

Review each agent's diff against the *Verification* section before reporting the phase done;
do not take an agent's summary as evidence that it did what it claims.

## Phase A — Record the decisions *(wave 1, here)*
- **Status:** done
- **Started:** 2026-09-27 23:12
- **Ended:** 2026-09-27 23:14

1. `CLAUDE.md`: add the table-library choice — PrimeNG (`p-table`/`p-treetable`) is this
   project's table library, no ag-Grid Enterprise licence, ag-Grid removed; point at the
   `angular-primeng-table` skill. Add a context-loading row for it next to the existing
   `transactions-table` row, and drop the **No Angular Material** paragraph's neighbours only
   if they mention ag-Grid (they do not — leave them).
2. Persist this plan to `docs/plans/20260927-primeng-transactions-table-accepted.md` per
   `../claude-config/plan-mode.md`, and keep its status suffix in sync from here on.

## Phase B — Dependencies and tooling *(wave 1, here)*
- **Status:** done
- **Started:** 2026-09-27 23:05
- **Ended:** 2026-09-27 23:13

1. ✅ `pnpm add primeng@21 @primeuix/themes` → `primeng ^21.1.10`, `@primeuix/themes ^3.0.1`.
   `@angular/animations` was already a direct dependency, so nothing changed there and
   `provideAnimationsAsync()` is still not needed.
2. ✅ `claude plugin marketplace add primefaces/primeui-plugins` +
   `claude plugin install primeng@primeui` (user scope; ships the seven `primeng-*` skills).
3. ⚠️ **Deviation — there is no usable v21 MCP server.** The plugin ships one pinned to
   `@primeng/mcp@>=22.0.0 <23.0.0`, i.e. **v22 docs for a v21 project**. Pinning our own to
   v21 failed: every 21.x release of `@primeng/mcp` (21.1.10, 21.1.9, 21.1.0, 21.0.4) crashes
   at startup with `Tool get_migration_guide expected a Zod schema or ToolAnnotations` — the
   bundled `@primeuix/mcp` is incompatible with the current `@modelcontextprotocol/sdk`. A
   vendor bug, not fixable here; the broken `primeng21` entry was removed again.

   **Consequence for every phase below:** the available MCP answers **v22**, while this project
   runs **21.1.10**. Treat its answers as a lead, not a fact, and verify each API against
   `packages/frontend/node_modules/primeng/types/primeng-table.d.ts` — which is authoritative
   for the installed version. The v21 facts in *Constraints discovered during research* were
   established against those typings and the v21 bundle, so they stand.

## Phase C — App-level PrimeNG setup *(wave 2 — agent `setup-i18n`)*
- **Status:** done
- **Started:** 2026-09-27 23:18
- **Ended:** 2026-09-27 23:32

In `packages/frontend/src/app/app.config.ts`:

```ts
providePrimeNG({
  theme: { preset: Aura, options: { darkModeSelector: '.dark-mode', cssLayer: true } },
})
```

- `darkModeSelector: '.dark-mode'` is mandatory — the default `'system'` reads
  `prefers-color-scheme` and would bypass `ThemeService`, which owns the dark axis for all
  five theme identities.
- `cssLayer: true` so the app's own CSS outranks PrimeNG's without specificity hacks.
- Wire `inject(PrimeNG).setTranslation(...)` to the active locale (an `effect` on
  `LocaleService.locale`), fed from the new i18n keys in Phase G.

## Phase D — Theming bridge *(wave 2 — agent `theming`)*
- **Status:** done
- **Started:** 2026-09-27 23:18
- **Ended:** 2026-09-27 23:41

New `packages/frontend/src/styles/_primeng-table.scss`, imported by `styles.scss`, in the
two-layer shape the deleted `base-table.component.scss` used:

1. Layer 1 — `--app-table-*` tokens at `:root`, each defaulting to a global token
   (`--surface-card`, `--text-color`, `--surface-border`, `--surface-subtle`,
   `--surface-hover`, `--color-accent`, `--radius-base`, `--font-sans`, `--text-sm`).
   Port the names from `base-table.component.scss` — that file is the reference.
2. Layer 2 — map PrimeNG's own variables onto layer 1: `--p-datatable-row-background`,
   `--p-datatable-row-hover-background`, `--p-datatable-row-striped-background`,
   `--p-datatable-header-cell-background|color|border-color`,
   `--p-datatable-body-cell-border-color`, `--p-datatable-root-border-color`, and the
   paginator/sort-icon tokens. Authoritative name list:
   `node_modules/@primeuix/themes/dist/aura/datatable` (token path → `--p-datatable-…`),
   or the MCP.

`styles/_theme-greenbar.scss:88` overrides `--base-table-row-alt-bg` — rename that one line
to the new `--app-table-*` token. No other theme file touches table tokens, and none target
`.ag-*`, so theming needs no further changes.

## Phase E — The table itself *(wave 2 — agent `table`)*
- **Status:** done
- **Started:** 2026-09-27 23:18
- **Ended:** 2026-09-27 23:49

Rewrite `features/transactions/transactions.component.{ts,html,scss}`.

**View row.** A `TransactionViewRow` type local to the feature: every raw `TransactionRow`
field as stored, plus `konto_name`/`konto_bic`/`konto_kontonummer`/`konto_bezeichnung`,
`category_name`, and `datum_date`/`valuta_date` (`Date | null`, filter-only). Built in a
**`signal`, not a `computed`** — rebuilt by a small effect when `items`/`accounts`/
`categories` change, so the category update can mutate it in place without a new array
identity. Values are still shown exactly as stored (skill §2): the lookups only *attach*
resolved values, they never rewrite DB columns.

**Template.** `<p-table>` with `dataKey="id"`, `[paginator]="true" [rows]="20"`,
`sortMode="multiple"`, `[multiSortMeta]="[{field:'datum',order:-1},{field:'id',order:-1}]"`,
`[globalFilterFields]` listing every displayed field, `[tableStyle]="{'min-width':'…'}"`,
and a localised `[currentPageReportTemplate]`. Three named templates: `#header` (a label
row with `pSortableColumn` + `p-sortIcon`, then a second `<tr>` of
`<p-columnFilter display="row" filterOn="input">` — `type="text"`, `type="numeric"` for
`betrag`/`saldo`, `type="date"` pointed at `datum_date`/`valuta_date`), `#body`, and
`#emptymessage` reusing `<p class="status-text">`. The search input keeps its `#filter-search`
id and calls `dt.filterGlobal(value, 'contains')`.

Header labels keep coming from `i18n.t('transactions.col…')` — the existing keys, unchanged.
Markup follows house style: `transaction-table__*` BEM names, `—` for empty values, tokens
only, `font-variant-numeric: tabular-nums` on amounts.

**Category update.** Keep the PATCH flow; on success mutate the row inside the existing
array (`rows[i] = { ...rows[i], umsatztyp_id, category_name }`) and `markForCheck()`. The
array identity must not change, or an active filter sends the user back to page 1.

## Phase F — Cell components *(wave 2 — agent `table`)*
- **Status:** done
- **Started:** 2026-09-27 23:18
- **Ended:** 2026-09-27 23:49

The `TransactionCell` base class and `cells/transactions-grid-context.ts` exist only to carry
ag-Grid's `agInit`/`refresh`/`context` plumbing — **delete both**. The two cells take plain
signal inputs instead:

- `AmountCellComponent`: `input<number | null>()`. Keep the dual signed/parenthesised DOM and
  the `transaction-table__amount--negative|--positive` host classes exactly — four theme
  files style them.
- `CategoryCellComponent`: `input` for the row, the categories and the failed-update id, plus
  an `output` for the change. No context indirection.

Drop `gridContext()`/`cellParams()` from `testing/transaction-fixture.ts`.

## Phase G — i18n *(wave 2 — agent `setup-i18n`)*
- **Status:** done
- **Started:** 2026-09-27 23:18
- **Ended:** 2026-09-27 23:32

In `src/i18n/en.json` and `de.json` (always both):

- Remove the 30 `grid.*` keys and `core/utils/grid-locale-text.ts`.
- Add a PrimeNG-shaped set for what the table actually shows: the filter match modes in use
  (`startsWith`, `contains`, `notContains`, `endsWith`, `equals`, `notEquals`, `lt`, `lte`,
  `gt`, `gte`, `dateIs`, `dateIsNot`, `dateBefore`, `dateAfter`, `noFilter`), `clear`,
  `apply`, `matchAll`, `matchAny`, `addRule`, `removeRule`, the `aria.*` strings the table
  and paginator read, and one key for the paginator report template.
- Feed them to `setTranslation()` from Phase C via a replacement for `gridLocaleText` —
  same idea (typed keys, compile error when missing), new shape.

## Phase H — Remove ag-Grid *(wave 3 — agent `cleanup`)*
- **Status:** done
- **Started:** 2026-09-27 23:36
- **Ended:** 2026-09-27 23:43

1. Delete `core/components/base-table/` entirely (component, `.theme.ts`, `.scss`, spec —
   the spec only asserts ag-Grid pass-through and has nothing worth porting).
2. Remove `ag-grid-angular` and `ag-grid-community` from `packages/frontend/package.json`.
3. Unlink `.claude/skills/ag-dev`, `ag-update` and `angular-ag-grid-table`; leave
   `angular-primeng-table` and the local `transactions-table` skill.
4. Rewrite `transactions-table/SKILL.md` §3 around PrimeNG: sorting/filtering/paging remain
   client-side in the table and never move to the backend; the `cellDataType`/`valueGetter`/
   `BaseTableComponent`/`ag-dev` rules are replaced by the view-row rule, `p-columnFilter`
   types, and a pointer to `angular-primeng-table`. Keep §1, §2 and §4 intact — they are
   about the data contract, not the grid. The "Enterprise features are not an option" note
   becomes the licence rationale for PrimeNG.
5. Check `docs/architecture.md` for ag-Grid claims and update if present.

## Phase I — Tests *(wave 3 — agent `tests`)*
- **Status:** done
- **Started:** 2026-09-27 23:50
- **Ended:** 2026-09-28 07:40

`transactions.component.spec.ts`: 9 of 12 tests query `.ag-row`/`.ag-cell`/
`.ag-header-cell-text`/`.ag-paging-panel` or call `GridApi`, so they are retargeted, not
rewritten from scratch — the *assertions* are the parity contract and must survive:

- Row/cell counts → `tbody tr` / `td`; keep the 14-dash-cell and 18-German-header
  assertions verbatim.
- `displayedIds()` → read rendered row order from the DOM instead of
  `forEachNodeAfterFilterAndSort`.
- Sorting click → `th[pSortableColumn]`; pager assertions → PrimeNG paginator markup.
- The `autoSizeStrategy` test is deleted (the capability is gone); replace it with one
  asserting the `min-width` hint and that no per-column widths are set.
- The filter-model test becomes UI-driven through `p-columnFilter`.
- The category test drops the `context` indirection and calls the component/output directly;
  it must still assert the PATCH body **and** that the user stays on the page.

Keep `installMutationObserverMock()` — the category picker still uses CDK overlays. Rewrite
the two cell specs for plain inputs. The `wait(50)` in `settle()` existed for ag-Grid's async
render; keep it until the suite is green, then try removing it.

## Verification *(wave 4, here)*

1. `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build` (the
   project checklist's sequence).
2. `pnpm dev` and check in the browser, against real data:
   - all 19 columns present, headers translated, `—` for empty values;
   - newest booking first with the id tie-break; clicking a header re-sorts;
   - per-column filters (text, numeric, **and the two date columns** — the ISO-string trap);
   - the search box filters across every column **including account holder and category**;
   - pagination at 20 rows; changing a category keeps page, sort and filters;
   - switch locale → paginator, filter menus and headers all follow;
   - switch each of the five theme identities and toggle dark mode → the table follows, with
     greenbar's row striping intact.
3. Confirm no `ag-grid` string remains: `grep -ri "ag-grid\|ag-dev\|\.ag-" packages/frontend/src docs`.

## Outcome (2026-09-28)

All phases done. `pnpm test` (66 tests, 12 files), `pnpm lint`, `pnpm format:check` and
`pnpm build` all pass, and the table was verified in the browser against the real database
(9,965 rows): 18 columns, account/category lookups resolving, pagination `1 to 20 of 9965`,
global search over a looked-up column (`Tagesgeld` → 267 rows), the date filter
(16 July 2026 → 3 rows, no `.toDateString()` throw), the empty state, and the theme bridge
across default/greenbar × light/dark with greenbar striping rendering in both.

### Two defects found in review, fixed before completion

1. **Stale category under an active filter.** The category update replaced the row object,
   but PrimeNG renders `filteredValue`, which holds *references* to row objects — so a
   filtered view kept rendering the old one. Fixed by mutating the row in place (same array
   *and* object identity) and binding the changed primitive (`[categoryId]`) into the cell,
   since an in-place mutation never changes an OnPush input. Locked in by a new test.
2. **Greenbar striping was dead.** PrimeNG gates striping on `[stripedRows]`, which the
   template did not set, so the striped-row token bridge had nothing to apply to. Fixed and
   covered by a new test.

A third gap surfaced from the tests themselves: `[currentPageReportTemplate]` alone renders
nothing — PrimeNG gates the report element on `[showCurrentPageReport]`, which was missing,
so the localised pager line never appeared. Fixed.

### Follow-ups (not done here)

- **Initial bundle is over budget**: 629.31 kB against a 500 kB warning threshold (1 MB
  error, so the build still passes). `app.config.ts` eagerly imports `Aura` from
  `@primeuix/themes/aura` — a single ~796 kB default export covering every component, which
  cannot tree-shake per component — whereas ag-Grid used to sit in the lazily-loaded
  transactions chunk. Options: load the preset lazily, build a trimmed custom preset, or
  accept and raise the budget. A decision, not a cleanup.
- **Column sizing**: the deferred "minimal sizing" decision shows up concretely — the two
  date columns are narrow enough that their filter datepicker inputs render ~22 px wide,
  which is effectively unusable by mouse. This is the first thing to fix when sizing is tuned.
- **`p-columnFilter` shows a filter menu button** per column (`showMenu` defaults to true),
  unlike ag-Grid's suppressed header menu. Left at the default; suppress if unwanted.
- **Orphaned ag-Grid skill files**: `.agents/skills/ag-dev/`, `.agents/skills/ag-update/` and
  the untracked root `skills-lock.json` are no longer referenced. Left in place — deleting
  untracked files is the user's call.
