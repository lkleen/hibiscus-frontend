# Categories tree view

Source plan approved 2026-10-03. Phase 0 (plan-execution skill) was done in claude-config.


### Context
The user wants a read-only page for managing categories that shows the `umsatztyp` tree with the
ag-Grid Tree Data UX:
- an auto group column with a toggler;
- all rows expanded by default (`groupDefaultExpanded: -1`);
- a quick filter that keeps the ancestors of matches;
- sorting within each level.

This page is not linked to transactions. Aggregating transactions by category is a separate,
later feature. Editing comes in a later step.

Decisions made:
- Tree data becomes an option of `<app-data-table>`. The skill's "sibling component" line will be
  updated to say so.
- All `umsatztyp` columns are shown.
- A shared colour converter is added, and the transactions picker is fixed to use it too.
- `umsatztyp = NULL` is shown as "any", the way Hibiscus shows it.


### Findings
- **Colours:** `umsatztyp.color` is `VARCHAR(11)` in the `"r,g,b"` format. Hibiscus shows a colour
  only when `customcolor = 1`. The old categories page wrote `#rrggbb` values, so the database may
  contain both formats. Today the picker binds the raw string as CSS, so on real data no swatch
  appears.
- **Hibiscus values:**
  - type: `0` = expense, `1` = income, `2` = any (NULL also means any);
  - flags: `FLAG_SKIP_REPORTS = 1`;
  - `isregex` and `customcolor` count as true only when they are exactly `1`.
- **Shared contract:** `Category` is declared twice today, once in the backend repository and once
  in the frontend model. That breaks the shared-contracts rule. Replace it with `CategoryRow` in
  the shared package, using the columns as stored.
- **Tree building:** `buildCategoryTree` silently drops nodes that form a parent cycle. The generic
  builder throws instead.

### Verified PrimeNG 21.1.10 TreeTable mechanics (brief every agent: the MCP is v22)
Line numbers refer to `node_modules/primeng/fesm2022/primeng-treetable.mjs`.

**Module and templates**
- Import `TreeTableModule` (not standalone).
- Templates are `#header`, `#body` and `#emptymessage`.
- The body context's `$implicit` is the *serialized* node `{node, parent, level, visible}`. The
  d.ts types it wrongly.

**Row tracking and expansion**
- `rowTrackBy` receives the serialized node. Use `(_, s) => getRowId(getRawRow(s.node.data))`.
- Expansion state is `node.expanded`.
- When the `[value]` reference changes, PrimeNG re-sorts or re-filters and then re-serializes.
  Expand all and collapse all are therefore done by rebuilding the nodes.
- `<p-treeTableToggler [rowNode]>`:
  - indents 16px per level;
  - is hidden on leaf rows;
  - uses the aria labels `expandRow` and `collapseRow`.

**Sorting**
- `sortMode="multiple"` + `customSort` has a bug: every emission carries the *root* array, and
  children are never handed to the handler. The handler must sort the whole tree recursively. This
  is idempotent.
- There is no `showInitialSortBadge`, so hide `.p-sortable-column-badge` with CSS.
- `aria-sort` is wrong in multiple mode (PrimeNG bug, follow-up).

**Filtering**
- `filterMode` defaults to `'lenient'`: ancestors of a match are kept, and a matching node keeps
  all its descendants.
- `filter` and `filterGlobal` are debounced by 300 ms. Specs need `fakeAsync` and `tick(300)`.
- Function-valued `globalFilterFields` work, because `resolveFieldData` calls functions.
- The custom match mode works through the component-provided `FilterService`.
- **There is no column filter component.** Use our own text input that calls
  `tt.filter(v, colId, 'contains')`. That reads `node.data[colId]`, so the column-accessor proxy
  carries over.

**Layout and scrolling**
- **Don't use `scrollable`.** It splits the header and body into separate tables, and resizing
  then needs a colgroup.
- Use `[scrollable]="false"` and `[autoLayout]="true"` instead. Our own SCSS makes
  `.p-treetable-wrapper` scroll (with `max-height` or flex fill) and makes `thead th` sticky.

**Resize and reorder**
- Resize: `ttResizableColumn` / `ttResizableColumnDisabled`.
  - The handle is `[data-pc-section="columnresizer"]`.
  - The floor is read from the inline `th` `min-width` as px.
  - There is no nth-child `<style>`.
- Reorder: `ttReorderableColumn` goes on every `th`.
  - `onColReorder` emits `{dragIndex, dropIndex}`, so the existing handler works unchanged.
  - The mousedown bug is the same as in `p-table`. Widen the selector in `onHeaderMouseDown` to
    include `[data-pc-section="columnresizer"]`.

**Other**
- There is no `stripedRows` input. Use CSS `tbody > tr:nth-child(even)` with
  `--app-table-row-alt-bg`.

### Feature matrix in tree mode
- **Supported:** quick filter, sort, resize, reorder, `autoSizeStrategy`/`minWidth`, cell
  renderers, striping, `scrollHeight`.
- **Text-only:** the column filter row. A visible column with `filter: 'numeric' | 'date'` throws.
- **Excluded:** pagination. The tree options type has `pagination?: false`, plus a runtime throw,
  because PrimeNG paginates root nodes only.
- **Throws if set:** `externalFilter`.

### Phase 1: Foundations (blocks the rest)
- **Status:** done
- **Started:** 2026-10-03 21:40
- **Ended:** 2026-10-03 21:45

- New `packages/shared/src/contracts/categories.d.ts` with `CategoryRow`:
  - Columns: `id, name, nummer, pattern, isregex, umsatztyp, parent_id, color, customcolor,
    kommentar, konto_id, konto_kategorie, flags`, typed as stored (nullable where they can be
    NULL).
  - The doc comment follows the style of `AccountRow`.
- New `packages/frontend/src/app/core/utils/build-tree.ts`:
  - `buildTree<Row>(rows, { getId, getParentId }) → TreeBranch<Row>[]`.
  - Keeps the input order.
  - A dangling parent makes the row a root.
  - Throws on a duplicate id or a cycle.
  - Spec ported from `category-tree.spec.ts`.
- New `packages/frontend/src/app/core/utils/category-color.ts`:
  - `toCssColor(row)` returns null unless `customcolor === 1` (or the colour is null).
  - `"r,g,b"` becomes `rgb(r g b)` and `#rrggbb` passes through. Anything else throws.
  - Has its own spec.
- New `core/utils/testing/category-row-fixture.ts`: `categoryRow(overrides)`.

### Phase 2a: Backend (parallel)
- **Status:** done
- **Started:** 2026-10-03 21:46
- **Ended:** 2026-10-03 21:49

- `packages/backend/src/repositories/umsatztyp.ts`:
  - Drop `Category` and `toCategory`.
  - Select the 13 columns `ORDER BY name, id` and return the rows as-is.
- Update the doc comment in `routes/categories.ts`.
- New `umsatztyp.spec.ts`, mirroring `umsatz.spec.ts`.

### Phase 2b: Frontend contract migration (parallel)
- **Status:** done
- **Started:** 2026-10-03 21:46
- **Ended:** 2026-10-03 21:52

- `api.service.ts`: `getCategories(): Observable<CategoryRow[]>`.
- Delete `core/models/category.model.ts`, `core/utils/category-tree.ts` and its spec.
- `category-picker`: use `buildTree` (`branch.row`) and take `CategoryRow[]` inputs. Both swatches
  use `toCssColor`.
- Migrate to `CategoryRow` and the `categoryRow()` fixture: `category-cell`, `transactions.component`
  and their specs, plus `api.service.spec.ts`.

### Phase 2c: Tree mode in `<app-data-table>` (parallel; UI phase, frontend-design)
- **Status:** done
- **Started:** 2026-10-03 21:40
- **Ended:** 2026-10-03 21:58

**Model** (`data-table.model.ts`):
- Split the options into `DataTableFlatOptions | DataTableTreeOptions`.
- Tree options carry `treeData: { getParentId; groupColId; groupDefaultExpanded? }`, defaulting
  to `-1`.

**Pure helpers:** new `data-table-tree.ts`.
- `toTreeNodes(rows, config)` builds the nodes through `buildTree`.
- `sortTreeNodes(nodes, compare)` sorts recursively.
- `validateTreeMode(...)` throws on any of these:
  - a missing or hidden `groupColId`;
  - a numeric or date column filter;
  - `externalFilter` set;
  - a pagination object;
  - an invalid `groupDefaultExpanded`.

**Component** (`data-table.component.ts`):
- Add `TreeTableModule` and a `treeTable` viewChild.
- Expansion state is a `linkedSignal`. Public `expandAll()` and `collapseAll()` work like
  ag-Grid's.
- Add a `treeNodes` computed and `treeRowTrackBy`.
- `onTreeSortFunction` reuses `compareRows`. `resolveSortMeta` accepts `order: number` and throws
  unless it is ±1.
- `onTreeColumnFilter` calls `filter`.
- `onSearchInput` dispatches to the active table and throws if there is none.
- Widen the `onHeaderMouseDown` selector.
- Reused unchanged: `cellView`, `compareRows`, `globalFilterFields`, `headerMinWidth`,
  `onColReorder`.

**Template** (`data-table.component.html`):
- `@if (treeData()) <p-treetable #tt> @else <p-table #dt>`.
- A shared `#cellContent` template renders the cell.
- The tree header uses the `tt*` directives.
- The body row is `[ttRow]`, with the toggler in the group column.
- Expand-all and collapse-all buttons sit in the filters form.

**Styles:**
- `data-table.component.scss`: `.data-table--tree` gets the wrapper scroll, the sticky `th`,
  nth-child striping, a hidden badge and fill mode.
- `styles/_primeng-table.scss`: add the missing `--p-treetable-*` tokens:
  - header-cell hover and selected background/colour;
  - resize indicator;
  - node-toggle-button colours and focus ring;
  - row and header-cell focus rings.
- Rewrite the comments that say there is no tree table yet.

**i18n:**
- `primeng-translation.ts`: add `expandRow` and `collapseRow` to the aria keys.
- `en.json` / `de.json`: `primeng.aria.expandRow`, `primeng.aria.collapseRow`, `table.expandAll`,
  `table.collapseAll`.

**Specs:**
- `data-table-tree.spec.ts`: depth -1, 0 and 1; dangling parent; recursive sort; every validator
  throw.
- New tree `describe` in `data-table.component.spec.ts`:
  - TreeTable is rendered;
  - the toggler appears only in the group column;
  - expand all and collapse all;
  - the lenient quick filter and the column filter keep ancestors;
  - sorting within levels;
  - the renderer gets the raw row;
  - `refresh()` keeps expansion;
  - the validation throws.
- The flat-mode specs stay green.

### Phase 3: Categories page (needs 2b and 2c; UI phase, frontend-design)
- **Status:** done
- **Started:** 2026-10-03 21:59
- **Ended:** 2026-10-03 22:04

New files:
- `features/categories/categories.component.{ts,html,scss,spec.ts}`;
- `features/categories/cells/color-cell/`: swatch plus raw value, BEM, structural SCSS and
  component tokens only.

Edits: `app.routes.ts` (lazy `categories`), `header.component.ts` (nav entry after Transactions),
`en.json` / `de.json`.

Data loading mirrors `transactions.component.ts`: `getCategories` + `getAccounts`, `accountsById`,
and loading/error/empty states.

Columns:
- `name`: the group column.
- `nummer`.
- `umsatztyp`: translated as expense, income or any (NULL is "any"). An unknown number is shown
  raw.
- `pattern`.
- `isregex`: yes/no.
- `color`: the swatch.
- `customcolor`: yes/no.
- `kommentar`.
- `flags`: translate bit 1 as "skip reports"; other bits are shown numerically.
- `konto`: `konto_id` resolved to `bezeichnung`.
- `konto_kategorie`.
- A hidden `id` column as a sort tie-break.

Options: `treeData: { getParentId: r => r.parent_id, groupColId: 'name' }`,
`defaultSort` name asc + id asc, `scrollHeight: 'flex'`, `fitCellContents`, `getRowId`, `emptyKey`.

New i18n keys:
- `nav.categories`
- `categories.title` / `error` / `empty`
- `categories.col*`
- `categories.type.*`
- `categories.flag.skipReports`
- `categories.yes` / `no`

### Phase 4: Docs (needs 2c; runs alongside Phase 3)
- **Status:** done
- **Started:** 2026-10-03 21:59
- **Ended:** 2026-10-03 22:02

- `docs/architecture.md`:
  - `GET /api/categories` returns `CategoryRow` as stored;
  - the contracts paragraph names `…/categories`;
  - the data-table `treeData` option (what's supported and what's excluded);
  - a new Categories page subsection;
  - `buildTree`;
  - the colour format.
- `claude-config/skills/angular-primeng-table/SKILL.md`:
  - Replace "TreeTable gets a sibling generic component" with: tree data is an option of the one
    generic component.
  - Add the verified TreeTable mechanics above.
  - Keep the wording project-neutral, because this file is shared across projects.

### Phase 5: Verification (main session)
- **Status:** done
- **Started:** 2026-10-03 22:05
- **Ended:** 2026-10-03 22:25

- Run `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build`.
- Optional read-only DB check, aggregates only:
  `SELECT color LIKE '#%', customcolor, COUNT(*) FROM umsatztyp GROUP BY 1,2`.
- Browser check (`run` skill) on `/en/categories` and `/de/categories`, in the five themes in
  light and dark:
  - toggler indentation;
  - expand and collapse;
  - the lenient filter;
  - sorting within levels;
  - the sticky header;
  - resize and reorder, including a press on the `th` text;
  - greenbar striping.
- Regression-check the transactions page: picker swatches now render.

### Execution table
| Step | Agent | Model/effort | Wave | Write set | Reads |
|---|---|---|---|---|---|
| 0 — plan-execution skill | main session | — | 0 | skill, symlink, plan-mode.md, CLAUDE.md, memory | — |
| 1 — foundations | implementer-light | haiku/low | 1 | `categories.d.ts`, `build-tree.ts`(+spec), `category-color.ts`(+spec), `category-row-fixture.ts` | `accounts.d.ts`, `category-tree.ts`(+spec) |
| 2a — backend | implementer-light | haiku/low | 2 | `umsatztyp.ts`, `umsatztyp.spec.ts`, `routes/categories.ts` | `umsatz.spec.ts`, `categories.d.ts` |
| 2b — contract migration | implementer-light | haiku/low | 2 | api.service(+spec), category-picker, category-cell, transactions.component (+specs), deletions | `build-tree.ts`, `category-color.ts`, fixture |
| 2c — tree mode | implementer + frontend-design | sonnet/medium | 2 | data-table/*, `data-table-tree.ts`(+spec), `_primeng-table.scss`, `primeng-translation.ts`, i18n json | mechanics section of this plan |
| 3 — categories page | implementer + frontend-design | sonnet/medium | 3 | features/categories/**, app.routes, header, i18n json | transactions.component.ts, data-table.model.ts |
| 4 — docs | implementer-light | haiku/low | 3 | architecture.md, angular-primeng-table SKILL.md | this plan's findings and mechanics |
| 5 — verify | main session | — | 4 | — | — |

Phase 1 pins the contracts: the exact `CategoryRow`, `buildTree` and `toCssColor` signatures are
given in the wave-2 prompts. 2a, 2b and 2c have disjoint write sets. Wave 3 touches the i18n JSON
only in Phase 3, after 2c has finished.

### Risks
- The sticky header combined with `border-collapse` inside the tree-table wrapper has not been
  verified in a browser. Phase 5 checks it.
- Individual expansion state resets when `value` changes. Carrying it over by id is a possible
  follow-up.
- While a filter is active, toggling a node changes a shallow copy, so the change is lost when the
  filter is cleared. This is documented.

### Outcome
- Gates: format, lint, all tests (backend 4 files; frontend 25 files) and build pass. The only
  warning is the bundle budget that was already there (640.66 kB of 500 kB, previously ~629 kB).
- Browser, checked on real data (301 categories, 22 roots):
  - tree rendering and indentation;
  - the lenient quick filter ("amz" keeps Anschaffung → AMAZON → children);
  - descending sort within levels, with the hierarchy kept;
  - expand all and collapse all;
  - greenbar striping;
  - the sticky header while the table scrolls;
  - German labels.
- Fixed during verification: `app.component.scss` gave a fixed height and full width only to the
  transactions page. `app-categories` is now added to those `:has()` selectors.
- Not exercised by the data: colours and account restrictions. No row has `customcolor = 1` or a
  `konto_id`, so the unit specs cover them. The categories page throws on a `konto_id` whose
  account is not loaded (the transactions page shows a dash instead).
- Follow-ups:
  - the PrimeNG toggler `aria-label` always says "expand";
  - `aria-sort` is wrong in multiple sort mode;
  - manual expansion state is lost when the filter is cleared or `value` changes.
