# Ribbon toolbar for table views, with per-view density

**Plan status:** done

## Context

The transactions toolbar has run out of space: accounts, search, period, from/to, step,
selection and the tree controls all share one wrapping row. Export, the next feature, would need
room too. The user compared mockups (artifact `ChbmuBiEBv8nuA9erPH65s`) and chose **R1, a classic
ribbon** like MS Office. A tab strip switches between control sets, one band shows the active set
at full width with group captions below, and each tab shows its current state ("2 of 3 accounts",
the date range). On top of R1 the user wants the **whole toolbar collapsible**.

Decisions:

- **Sets:** Filter, Period, View, plus a contextual **Selection** tab that appears (accent-marked)
  only while rows are ticked. No Export tab yet (added with export), no Assign button.
- **Collapse:** three modes. _Full_ (tabs + band). _Tabs only_ (click the active tab). _Hidden_
  (arrow at the end of the strip): one slim line with state chips and a "Show toolbar" arrow.
- **Ribbon state** (active tab, mode): session only, in memory, per ribbon.
- **Density moves into View, per view.** It is saved per user per view, and the Settings tab
  "Table density" is removed. Views: transactions list, transactions by-category, categories page.
  The **categories page gets a ribbon too** (Filter: search; View: expand/collapse + density).
  Tables without a ribbon (pickers, dialog previews, settings) always use Normal.

## Design

### Shared contract — `packages/shared/src/contracts/user-settings.d.ts`

- `TableViewId = 'transactions-list' | 'transactions-by-category' | 'categories'`
- `TableDensities = Partial<Record<TableViewId, TableDensity>>`. A missing view means `normal`.
- Remove nothing else; `TableDensity` stays.

### Backend (replace the global density setting)

- `settings/table-density.ts`: `TableDensitiesSchema` (strict object of optional view → density),
  `TABLE_DENSITIES_SETTING_KEY = 'table-densities'` (new key, so the old string value is never
  parsed as a map), `DEFAULT_TABLE_DENSITIES = {}`.
- `routes/settings.ts`: replace `GET/PUT /table-density` with `GET/PUT /table-densities` (whole
  map, 204, zod-validated, same pattern as date presets). The old route is removed; the old
  `table-density` row in `hf_user_setting` is left untouched (never read).
- Specs in `routes/settings.spec.ts` adapted.

### Frontend: density per view

- `TableDensityService` (`core/services/table-density.service.ts`) keeps `UserSettingChannel`, now over
  `TableDensities`: `densityFor(view: TableViewId): Signal<TableDensity>` (computed, default
  `normal`) and `save(view, density)` (merges into the map, enqueues the whole map). It no longer
  touches `<html>`. `ApiService.getTableDensities/saveTableDensities` replace the old pair.
- `<app-data-table>` gets `density = input<TableDensity>('normal')`, rendered as host class
  `table-density-<id>`. `styles/_primeng-table.scss` keys the density tokens on that class instead of
  `:root.table-density-*`, so every table defaults to Normal.
- Settings: remove the `table-density` entry from `SETTINGS_TABS` and delete
  `features/settings/table-density/`. Remove the app-initializer load if it only served the `<html>`
  class (keep loading once at startup if views need it immediately). Drop unused i18n keys.

### Frontend: generic ribbon (`shared/components/ribbon/`)

Generic and page-agnostic, so the transactions shell and the categories page share it. Child
route components can add bands too.

- `RibbonHost` (`@Injectable()`, provided by the page, like `DataTableToolbarOutlet`): a signal
  list of registered bands `{ id, labelKey, order, state: Signal<string | null>, active:
Signal<boolean> (dot), contextual, shown: Signal<boolean>, template }`; `register(band)` returns an
  unregister function.
- `RibbonBandDirective`: `<ng-template appRibbonBand="filter" labelKey=… [order] [state] [active]
[contextual] [shown]>`. Registers with the injected `RibbonHost` on init and unregisters on
  destroy, so a tab component's Selection band comes and goes with the routed tab.
- `RibbonStateStore` (`providedIn: 'root'`, in memory): `Map<ribbonId, { activeId, mode }>` with
  `mode: 'full' | 'tabs' | 'hidden'`. Session only, so it is kept across route changes and reset on
  reload.
- `RibbonComponent` `<app-ribbon ribbonId="transactions">`: tab strip (`role="tablist"`, roving
  focus via CDK `FocusKeyManager`, arrows/Home/End; each tab shows label, state text and an
  active-filter dot; contextual tabs accent-marked). Clicking the active tab toggles full/tabs.
  A trailing "Hide toolbar" icon button → hidden mode: slim line with one chip per band state and a
  "Show toolbar" button. The active band renders via `ngTemplateOutlet` (`role="tabpanel"`). If the
  active band disappears (contextual tab hidden, view without it), it falls back to the first band.
- `RibbonGroupComponent` `<app-ribbon-group captionKey=…>`: controls on top, caption below,
  hairline separators between groups (Office band anatomy, as in the mockup).
- Styling: structural SCSS with `--ribbon-*` tokens defaulting to global tokens (all five themes),
  focus-visible, touch targets, reduced motion. The strip scrolls horizontally on phones.

### Transactions shell (`features/transactions/transactions.component.*`)

- Replace the filters form with `<app-ribbon ribbonId="transactions">`; the shell provides
  `RibbonHost` (and keeps `DataTableToolbarOutlet`).
- **Filter** band: groups Search (existing search input) and Accounts (`<app-account-filter>`).
  State: the accounts summary (reuse the account filter's trigger-label logic, extracted to a pure
  function), dot when accounts are excluded or the search is non-empty.
- **Period** band: `<app-date-range-filter>` split into groups Preset / Range / Step (its own field
  labels become visually hidden; group captions label them). State: the active range.
- **View** band: the `DataTableToolbarOutlet` `cdkPortalOutlet` (tree expand/collapse on the
  by-category tab) and a density picker for the active tab's view. `TRANSACTIONS_TABS` gains a
  `densityView: TableViewId` per tab; the list/by-category tables bind
  `[density]="densities.densityFor(view)"`.
- **Selection** (contextual): list and by-category register an `appRibbonBand="selection"` with
  "N selected" + Clear selection, `shown` = count > 0, state = count. The selection bar is no
  longer projected as `appDataTableToolbar` (the data table's projected-content portal stays
  generic).

### Categories page

- `<app-ribbon ribbonId="categories">` above the table, page provides `RibbonHost` +
  `DataTableToolbarOutlet`. **Filter**: a search field driving the table through a new
  `<app-data-table>` input `quickFilterText = input<string | null>(null)` (ag-Grid's name; when
  set, the table's own search field is hidden and `filterGlobal` uses it, keeping the lenient tree
  filter). **View**: tree expand/collapse (via the outlet) + density for `categories`.

### Shared density picker

`shared/components/density-picker/` (segmented control over `TABLE_DENSITIES`, labels from the
existing `settings.tableDensity.*`-style keys moved to `density.*`), `view` input, saves through
`TableDensityService`. Used by both View bands.

### Docs

`docs/architecture.md`: user settings (per-view densities, new route), settings page (one tab),
data table (`density`, `quickFilterText`), transactions shell toolbar → ribbon, categories page
ribbon. Transactions-table skill only if it references the toolbar.

## Phases & execution

| Step                                                                 | Agent             | Model/effort  | Wave | Write set                                                                                                                                                | Reads                                                     |
| -------------------------------------------------------------------- | ----------------- | ------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A Contract + backend per-view densities                              | implementer-light | haiku/low     | 1    | `user-settings.d.ts`, `settings/table-density.ts`, `routes/settings.ts`(+spec)                                                                           | date-presets route pattern                                |
| B Ribbon components (UI)                                             | implementer       | sonnet/high   | 1    | `shared/components/ribbon/*` (+specs), ribbon i18n keys                                                                                                  | mockup R1, `tab-nav`, `_filter-bar.scss`, frontend skills |
| C Data table `density` + `quickFilterText`, density SCSS             | implementer       | sonnet/medium | 1    | `data-table.component.*`, `data-table.model.ts`, `_primeng-table.scss` (+specs)                                                                          | —                                                         |
| D Density service per view, API, density picker, remove settings tab | implementer-light | haiku/low     | 2    | `table-density.service.ts`(+spec), `api.service.ts`(+spec), `shared/components/density-picker/*`, `features/settings/*`, i18n                            | A                                                         |
| E Transactions shell ribbon + selection band                         | implementer       | sonnet/high   | 2    | `transactions.component.*`, `transactions-tabs.ts`, list/by-category components, `date-range-filter.*`, `account-filter.*`, selection-bar (+specs), i18n | B, C pinned APIs                                          |
| F Categories page ribbon                                             | implementer-light | haiku/low     | 3    | `categories.component.*`(+spec), i18n                                                                                                                    | B, C, D                                                   |
| G Docs                                                               | implementer-light | haiku/low     | 3    | `docs/architecture.md`                                                                                                                                   | —                                                         |
| H Quality gates + browser check                                      | main session      | —             | 4    | —                                                                                                                                                        | —                                                         |

Pinned contracts for parallel waves: the `TableViewId`/`TableDensities` types (written in Phase 0
by the main session), `TableDensityService.densityFor/save`, data table `density`/`quickFilterText`,
and the ribbon API above. i18n files are touched by B, D and E in different waves, never in parallel
(B in wave 1, D and E in wave 2 → E adds its keys after D, or D's keys are added by the main session
between waves).

## Verification

- `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build`, all clean.
- Specs: ribbon (tab switching, keyboard, three modes, contextual tab appears/disappears and the
  fallback, state chips), data table density class and external quick filter, density service
  merge/save, settings route.
- Browser (`pnpm start:local` already running): transactions, switch Filter/Period/View; tick rows
  → Selection tab appears; Clear → it disappears and the ribbon falls back. Collapse to tabs only and
  hidden, check the slim-line chips, reload → back to defaults. Change density on the list, switch to
  by-category (own density), reload → both kept. Categories page: search filters the tree, density
  separate. Settings shows only date presets. Check light/dark and phone width.

## Sub-phases

### Phase 0 — Pin contract types + all i18n keys (main session)

- **Status:** done
- **Started:** 2026-10-18 20:30
- **Ended:** 2026-10-18 20:36

### Phase A — Contract + backend per-view densities

- **Status:** in progress
- **Started:** 2026-10-18 20:37
- **Ended:**

### Phase B — Ribbon components (UI)

- **Status:** in progress
- **Started:** 2026-10-18 20:37
- **Ended:**

### Phase C — Data table density + quickFilterText

- **Status:** in progress
- **Started:** 2026-10-18 20:37
- **Ended:**

### Phase D — Density service per view, picker, remove settings tab

- **Status:** todo
- **Started:**
- **Ended:**

### Phase E — Transactions shell ribbon + selection band

- **Status:** todo
- **Started:**
- **Ended:**

### Phase F — Categories page ribbon

- **Status:** todo
- **Started:**
- **Ended:**

### Phase G — Docs

- **Status:** todo
- **Started:**
- **Ended:**

### Phase H — Quality gates + browser check

- **Status:** todo
- **Started:**
- **Ended:**

Note: i18n keys for ribbon and density were all added in Phase 0, so no agent edits the i18n files in parallel (D only removes the old `settings.tableDensity.*` keys).

Outcome: all gates green (98 backend, 467 frontend tests); pre-existing bundle-budget warning unchanged. Deviations: D and the docs ran in parallel with wave 1/2 because their contracts were pinned; the ribbon was changed after B to keep every band rendered (inactive ones hidden), since the date filter sets the initial period on init and the View band hosts the table's portal outlet. Main-session follow-ups: hidden-mode chips are prefixed with their tab name ("Selection 1"), the ribbon has the old filter row's spacing, both search fields use the shared `.filters__field` style, `express.json` no longer needs `strict: false`. Browser check: Filter/Period/View bands, tree controls in View (by-category only), density per view saved and applied, contextual Selection tab, tabs-only and hidden modes, categories search through `quickFilterText`, Settings shows only Date presets.
