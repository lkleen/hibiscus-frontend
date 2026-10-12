# Row hover highlighting for `<app-data-table>` — plan

Plan status: done

## Context

Hovering a row in a table or tree currently shows no highlight: neither `<p-table>` nor
`<p-treetable>` in `data-table.component.html` sets PrimeNG's `rowHover` input, so the hover
colour already bridged in `_primeng-table.scss` (`--app-table-row-hover-bg` →
`--p-datatable-row-hover-background` / `--p-treetable-row-hover-background`, from the per-theme
`--surface-hover`) never renders. The user wants an **internal config switch** — not a user
setting, no UI — and it is **on for every table** in the app. Per CLAUDE.md, new table features go
into `<app-data-table>` as a switchable option, so this becomes a `DataTableOptions` flag with a
`true` default; no feature needs to set it.

Verified facts:
- PrimeNG 21 `Table` and `TreeTable` both have `rowHover: boolean | undefined`
  (`node_modules/primeng/types/primeng-{table,treetable}.d.ts`). It adds `p-datatable-hoverable` /
  `p-treetable-hoverable` to the host, and the Aura rule is
  `.p-*-hoverable .p-*-tbody > tr:not(.p-*-row-selected):hover { background: row.hover.background }`
  — plain `<tr>`, no `p-selectable-row` class needed.
- PrimeNG styles run in a CSS layer (`cssLayer: true`, `app.config.ts`), so any **unlayered** rule
  wins over them. The tree's own zebra rule in `data-table.component.scss:99`
  (`.data-table--striped ::ng-deep tbody > tr:nth-child(even)`) is unlayered → in greenbar (the only
  theme with a visible stripe) even tree rows would **not** highlight. Needs an explicit rule.
  Flat tables are fine: their striping is PrimeNG's own (same layer, lower specificity than hover).

## Phase A — `rowHover` option in `<app-data-table>`
- **Status:** done
- **Started:** 2026-10-12 18:58
- **Ended:** 2026-10-12 19:02

1. `data-table.model.ts` — add to `DataTableOptionsBase` next to `striped`:
   `readonly rowHover?: boolean;` with a doc comment (maps to PrimeNG `[rowHover]` on both
   `<p-table>` and `<p-treetable>`; colour is `--app-table-row-hover-bg`; default `true`, see
   `DEFAULT_TABLE_OPTIONS`).
2. `data-table.defaults.ts` — add `readonly rowHover: boolean` to the `DEFAULT_TABLE_OPTIONS` type
   and `rowHover: true` to the value.
3. `data-table.component.ts` — next to `striped` (~line 341):
   `protected readonly rowHover = computed<boolean>(() => this.options().rowHover ?? DEFAULT_TABLE_OPTIONS.rowHover);`
4. `data-table.component.html` — `[rowHover]="rowHover()"` on `<p-table>` and `<p-treetable>`;
   on `<p-treetable>` also `[class.data-table--row-hover]="rowHover()"` (next to
   `[class.data-table--striped]`).
5. `data-table.component.scss` — directly after the tree zebra rule, inside the same block:
   ```scss
   // Unlayered like the zebra rule above, which would otherwise beat PrimeNG's (layered) hover.
   &.data-table--row-hover ::ng-deep tbody > tr:hover {
     background: var(--app-table-row-hover-bg);
   }
   ```
6. `data-table.component.spec.ts` — following the existing `striped` tests' pattern: flat table
   host has `p-datatable-hoverable` by default and not with `rowHover: false`; tree likewise with
   `p-treetable-hoverable` and `data-table--row-hover`.

No feature changes (default covers all tables, including the density demo table), no backend,
no shared contract, no i18n.

## Phase B — Verification
- **Status:** done
- **Started:** 2026-10-12 19:02
- **Ended:** 2026-10-12 19:02

- Quality gates from repo root: `pnpm format:fix`, `pnpm format:check`, `pnpm lint`,
  `pnpm test`, `pnpm build` — all clean.
- Browser (dev server, Claude in Chrome): hover rows on the transactions table (flat) and the
  by-category tree view; check the highlight appears and follows the pointer in theme `default`
  light + dark and `greenbar` (both odd and even rows, flat and tree), and that header cells,
  toggler buttons and the empty-message row behave sensibly.

Outcome: all gates green (324 frontend tests). The tree host class is `p-treetable-hoverable-rows`
in PrimeNG 21, not `p-treetable-hoverable`; the specs assert the real class. Browser check not run
(no dev server/DB available in the session). The build reports a pre-existing initial-bundle budget
warning (661.99 kB vs 500 kB), identical without this change.


## Execution

| Step | Agent | Model / effort | Wave | Write set | Reads |
|------|-------|----------------|------|-----------|-------|
| A1–A6 | implementer-light | haiku / low | 1 | `shared/components/data-table/data-table.{model,defaults,component}.ts`, `.html`, `.scss`, `.spec.ts` | this plan |
| B quality gates | main session | — | 2 | — | — |
| B browser check | implementer-light | haiku / low | 2 | — | this plan |
