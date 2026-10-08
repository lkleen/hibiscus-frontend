# Table density setting

## Context

All tables (`<app-data-table>`) share one look: cell padding `0.5rem / 0.75rem` hard-coded in
`styles/_primeng-table.scss`, font size from `--app-table-font-size`, which the transactions
(`--text-xs`) and categories (`--text-sm`) features override themselves. The user wants a new
settings tab **"Table density"** next to "Date presets": five fixed presets that set font size and
cell padding of **every table globally**, stored per user in `hf_user_setting` like the date presets.
Left: the preset picker; right: a demo table showing the active preset.

Decisions (confirmed): the global setting wins (per-feature font-size overrides are removed);
clicking a preset saves it immediately (no Apply button); default for users without a stored value
is **Normal** (today's look).

## Presets

| id              | font size     | cell padding (y / x) |
| --------------- | ------------- | -------------------- |
| `extra-compact` | `--text-xs`   | `0.125rem / 0.375rem` |
| `compact`       | `--text-xs`   | `0.25rem / 0.5rem`   |
| `normal` (default) | `--text-sm` | `0.5rem / 0.75rem` (today) |
| `comfortable`   | `--text-base` | `0.75rem / 1rem`     |
| `spacious`      | `--text-md`   | `1rem / 1.25rem`     |

The values live **only in SCSS** (one map); TS only knows the ids.

## Phases

### Phase A — Shared contract
- **Status:** done
- **Started:** 2026-10-08 21:24
- **Ended:** 2026-10-08 21:24

`packages/shared/src/contracts/user-settings.d.ts`: add
`export type TableDensity = 'extra-compact' | 'compact' | 'normal' | 'comfortable' | 'spacious';`
(doc: body of `PUT /api/settings/table-density`, response of `GET`). Types-only, so each side keeps
its runtime list typed so it can't drift: `const TABLE_DENSITIES = [...] as const satisfies readonly TableDensity[]`
plus a compile-time exhaustiveness check (`Exclude<TableDensity, (typeof TABLE_DENSITIES)[number]>`
must be `never`) — same "pinned in the contract, checked on each side" idea as `DatePresetLimits`.

### Phase B — Backend
- **Status:** done
- **Started:** 2026-10-08 21:24
- **Ended:** 2026-10-08 21:45

- New `packages/backend/src/settings/table-density.ts` (mirrors `settings/date-presets.ts`):
  `TABLE_DENSITY_SETTING_KEY = 'table-density'`, `DEFAULT_TABLE_DENSITY: TableDensity = 'normal'`,
  `TableDensitySchema: z.ZodType<TableDensity> = z.enum(TABLE_DENSITIES)`.
- `routes/settings.ts`: `GET /table-density` (stored value or default, re-validated; corrupt row →
  `next(error)`, exactly like date presets) and `PUT /table-density` (zod-validated, `204`). No
  DELETE — "Normal" is just one of the presets.
- `routes/settings.spec.ts`: cases mirroring the date-preset ones (default when unset, stored value,
  corrupt row → 500, valid PUT → 204 + `putUserSetting` args, invalid PUT → 400).

### Phase C — Frontend data layer
- **Status:** done
- **Started:** 2026-10-08 21:24
- **Ended:** 2026-10-08 21:45

- **Extract the persistence policy once** — new `core/services/user-setting-channel.ts`: a small
  generic class `UserSettingChannel<T>` holding what `DatePresetService` does today: load once
  (`value`/`loaded`/`loadError` signals; a write finishing before the load wins), serial write queue
  via `concatMap` (`saving`, `saveError`), only confirmed state is exposed. Constructed with
  `{ load: () => Observable<T>, initial: T, label: string }` (label for the `console.error`s) and a
  `DestroyRef`; `enqueue(write: Observable<T>)`. Refactor `DatePresetService` onto it with its public
  API unchanged (`presets`, `loaded`, `loadError`, `saving`, `saveError`, `save`, `restoreDefaults`,
  `label`) — `date-preset.service.spec.ts` must stay green unchanged. Rationale: two services with the
  same load/queue/confirmed-only rules must change together (DRY "must change together").
- `ApiService`: `getTableDensity()` / `saveTableDensity(density)` next to the date-preset methods.
- New `core/services/table-density.service.ts` (`providedIn: 'root'`): uses the channel; exposes
  `density`, `loaded`, `loadError`, `saving`, `saveError`, `save(density)`; an `effect` puts exactly
  one `table-density-<id>` class on `<html>` (removing the others, like `ThemeService.applyClasses`).
  Exports `TABLE_DENSITIES` (the typed runtime list from Phase A). Spec mirrors
  `date-preset.service.spec.ts` (load, save order, failed save, class on `<html>`).
- `app.config.ts`: add `inject(TableDensityService)` to an app initializer so the class is applied on
  every page, not only after visiting settings. Before the load answers no class is set → the
  `:root` defaults = Normal.

### Phase D — Global styles
- **Status:** done
- **Started:** 2026-10-08 21:24
- **Ended:** 2026-10-08 21:45

- `styles/_primeng-table.scss`: add layer-1 token `--app-table-cell-padding-y: 0.5rem`; replace the
  four hard-coded `0.5rem` in the `*-header-cell-padding`, `*-header-padding`, `*-body-cell-padding`
  (datatable + treetable) with it. Add one SCSS map `$table-densities` (id → font-size, padding-y,
  padding-x) and an `@each` generating `:root.table-density-<id> { --app-table-font-size; …-padding-y; …-padding-x }`.
  `normal` equals the `:root` defaults (keep its map entry for completeness; generated block is a no-op).
- Remove `--app-table-font-size` from `features/transactions/transactions.component.scss` and
  `features/categories/categories.component.scss` (global wins), including the stale comment.

### Phase E — Settings tab UI
- **Status:** done
- **Started:** 2026-10-08 21:26
- **Ended:** 2026-10-08 21:45

Invoke `frontend-design:frontend-design` first (UI rule).
- `features/settings/settings-tabs.ts`: second entry `{ path: 'table-density', labelKey: 'settings.tab.tableDensity', loadComponent: … }`.
- New `features/settings/table-density/table-density.component.{ts,html,scss,spec.ts}`:
  - Same status block as date presets (hint, loading, load error, save error, "Saving…").
  - Layout: flex column on mobile; from `768px` (`--ds-breakpoint-md`) two columns — picker left
    (fixed ~16rem), demo right (`flex: 1; min-width: 0`).
  - Picker: a `<fieldset>` of native radio inputs (one `<label>` per preset: name + a muted one-line
    description), checked = `service.density()`, `(change)` → `service.save(id)`, disabled while
    `saving()`. Structural SCSS + `--table-density-*` component tokens only; reuse
    `_preset-buttons.scss` tokens/mixins where a button appears.
  - Demo: `<app-data-table>` with ~6 static sample rows (date, payee, purpose, amount, balance),
    `quickFilter: false`, no paginator, no tree. It inherits the global `<html>` class, so it shows
    the saved preset with no extra wiring. Sample cell texts and headers via i18n.
  - Spec: renders five options, the confirmed one is checked, selecting one calls `save`, inputs
    disabled while saving.
- i18n (`en.json` + `de.json`): `settings.tab.tableDensity`, `settings.tableDensity.{hint,loading,loadError,saveError,saving,legend,demoLabel}`,
  `settings.tableDensity.preset.<id>` + `.description.<id>`, demo column headers and sample texts.

### Phase F — Docs
- **Status:** done
- **Started:** 2026-10-08 21:24
- **Ended:** 2026-10-08 21:45

`docs/architecture.md`: API table (`GET/PUT /api/settings/table-density`), User settings (table
density as the second setting, `UserSettingChannel`), Settings (second tab), data-table paragraph
(density classes on `<html>` set `--app-table-*` layer-1 tokens globally; features no longer
override font size).

## Execution

Plan copied to `docs/plans/20261008-table-density-<status>.md`, executed via the `plan-execution` skill.

| Step | Agent | Model / effort | Wave | Write set | Reads |
| ---- | ----- | -------------- | ---- | --------- | ----- |
| A | implementer-light | haiku / low | 1 | `shared/…/user-settings.d.ts` | contract file |
| D | implementer-light | sonnet / low | 1 | `_primeng-table.scss`, transactions/categories `.scss` | `_primeng-table.scss` |
| B | implementer-light | sonnet / low | 2 | backend `settings/table-density.ts`, `routes/settings.ts`, spec | date-presets backend files |
| C | implementer | sonnet / medium | 2 | channel, `date-preset.service.ts`, `table-density.service(.spec).ts`, `api.service.ts`, `app.config.ts` | `date-preset.service(.spec).ts`, `theme.service.ts` |
| E | implementer | sonnet / medium | 3 | `features/settings/table-density/*`, `settings-tabs.ts`, `i18n/*.json` | date-presets component, data-table model |
| F | implementer-light | haiku / low | 3 | `docs/architecture.md` | this plan |

## Verification

- Quality gates from repo root: `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build` — all green, no warnings.
- Race check: density writes go through the single serial channel; initial load never overwrites a newer confirmed write (covered in spec).
- Manual (`pnpm start:local`, Chrome): Settings → Table density; pick each preset → demo table
  changes after save, reload keeps it, transactions and categories tables follow; check light/dark
  and a couple of theme identities; mobile width stacks picker above demo.
