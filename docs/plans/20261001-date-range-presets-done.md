# Date range filter with per-user presets

Status: **done**. The file is renamed as the plan advances, per `plan-mode.md`.

## Context

The transactions view has a search bar (`<app-data-table>`'s quick filter), but there is no way to
narrow the table to a date range. You want a start date input, an end date input and a preset
dropdown. Out of the box the dropdown offers *current month*, *last month*, *current year* and
*last year*. Users can edit, add and remove presets. Presets apply app-wide because other views
will use the same picker later, so they must be persisted per user. This is the app's first
user-specific data.

Decisions (asked):
- **Storage:** an app-owned table in the Hibiscus MariaDB, keyed by the forward-auth identity.
- **Preset kinds:** *relative* (rolls with today) and *fixed* (two dates).
- **Selection:** session only, per view. Only the preset list is persisted.
- **Management:** a new **Settings** page, linked from the user menu. The dropdown only selects.

## Design

**Subject.** A bookkeeping control for one person checking their own bank history. Its job is to
answer "which bookings am I looking at?" at a glance.

**Memorable element (one only).** Every preset in the dropdown shows **the dates it will resolve
to today**, right-aligned and muted: *Last month … 2026-09-01 – 2026-09-30*. A relative preset is
only useful if you can see what "last quarter" means right now. This reuses the user menu's
label/value item layout (`user-menu__item-label` / `user-menu__item-value`), so the picker reads as
part of the same app.

Everything else stays quiet:
- **Palette and type.** Global tokens only (`--surface-*`, `--text-*`, `--color-accent`,
  `--font-sans`). The five themes keep owning the look, with no new colors or fonts. Dates are
  ISO (`yyyy-MM-dd`) as everywhere else in the app.
- **Layout.** One row in the existing `.filters` form, laid out like the search field:
  ```
  Search                              Period                 From          To
  [Search all columns…        ]       [Current month  ▾]     [2026-10-01]  [2026-10-31]
  ```
  The row wraps at narrow widths, because `.filters` already has `flex-wrap`. Labels sit above
  their fields and align left, matching the existing filter field.
- **Copy.** The trigger shows the preset's name, *Custom range* once a date is edited by hand, and
  *All dates* for no range. The last menu item, *All dates*, clears the range. Sentence case, no
  arrows.
- **Settings page.** A plain, left-aligned list of presets. Each row shows the name, the resolved
  dates, and *Edit*, *Move up*, *Move down* and *Delete*. *Edit* expands an inline form. Below the
  list are *Add preset* and *Restore defaults*. Reordering also sets the default, because **the
  first preset is what every view starts on**. A one-line hint states this rule.

## Data model — `packages/shared/src/contracts/user-settings.d.ts` (new)

```ts
export type DatePresetUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

interface DatePresetBase {
  /** Client-generated (crypto.randomUUID), stable across edits. */
  id: string;
  /** User-given name; `null` = a translated name generated from the definition. */
  name: string | null;
}
/** `count` whole `unit` periods, the last of which is `offset` periods from the current one
 *  (0 = current, -1 = previous). Weeks start Monday (ISO). E.g. last 30 days = day/0/30. */
export interface RelativeDatePreset extends DatePresetBase {
  kind: 'relative'; unit: DatePresetUnit; offset: number; count: number;
}
export interface FixedDatePreset extends DatePresetBase {
  kind: 'fixed'; from: string; to: string; // YYYY-MM-DD, inclusive
}
export type DatePreset = RelativeDatePreset | FixedDatePreset;
```

Because the default presets have `name: null`, they get translated names that follow a language
switch: *Current month* / *Aktueller Monat*. Generated names cover offset 0 or -1 with count 1
("Current/Last {unit}"), offset 0 with count n ("Last {n} {units}"), and a general fallback.

## Backend — `packages/backend`

1. **`src/repositories/user-setting.ts` (new).** Generic per-user key/value storage:
   - `ensureUserSettingTable()` runs `CREATE TABLE IF NOT EXISTS hf_user_setting (user_name
     VARCHAR(255) NOT NULL, setting_key VARCHAR(64) NOT NULL, value LONGTEXT NOT NULL,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (user_name, setting_key))`. The `hf_` prefix keeps it clear of Hibiscus tables.
   - `getUserSetting(user, key): Promise<unknown | undefined>` parses the JSON.
   - `putUserSetting({ user, key, value })` uses `INSERT … ON DUPLICATE KEY UPDATE`, which is
     atomic, so concurrent saves can't create duplicate rows. The params object respects
     `max-params`.
   - `deleteUserSetting(user, key)`.
2. **`src/routes/settings.ts` (new)**, mounted as `api.use('/settings', …)` behind `requireAuth`.
   The user always comes from `res.locals['user']` and never from the request:
   - `GET /api/settings/date-presets` returns `DatePreset[]`. With no stored row it returns
     `DEFAULT_DATE_PRESETS`, so the defaults have a single source of truth (SPOT). A stored value
     is re-validated against the zod schema, and a corrupt row throws, which surfaces as a 500
     instead of being silently replaced.
   - `PUT /api/settings/date-presets` takes the whole list, validates it with zod (unique ids, at
     most 50 presets, name ≤ 80 chars, `count` 1–366, `offset` -100–0, `from ≤ to`, ISO dates)
     and answers `204`.
   - `DELETE /api/settings/date-presets` restores the defaults and answers `204`.
   - The zod schema is typed `z.ZodType<DatePreset[]>`, so it can't drift from the shared contract.
3. **`src/settings/date-presets.ts` (new)** holds `DEFAULT_DATE_PRESETS` (month 0, month -1,
   year 0, year -1, all `name: null`) and the zod schema.
4. **`server.ts`** makes `main` async and awaits `ensureUserSettingTable()` after `initPool`,
   before `listen`. A failure there is fatal, through the existing catch. That catch must now
   handle the promise.
5. **Tests:** a route spec covering default fallback, a PUT/GET round trip, validation 400s and the
   user scoping, with the repository mocked, as in `umsatz.spec.ts`.

## Frontend — `packages/frontend/src/app`

1. **`core/utils/date-range.ts` (new, pure).**
   - `DateRange { from: string | null; to: string | null }` (ISO, inclusive).
   - `resolvePreset(preset, today: Date): DateRange` uses local calendar math, with Monday-start
     weeks and quarters Jan/Apr/Jul/Oct.
   - `toIsoDate(date)`.
   - `isInRange(iso, range)` compares strings directly, because ISO dates compare lexically.
   - A spec covers every unit and offset, year boundaries, and the 31st → February case.
2. **`core/services/api.service.ts`** gains `getDatePresets()`, `saveDatePresets(list)` and
   `resetDatePresets()`.
3. **`core/services/date-preset.service.ts` (new, `providedIn: 'root'`).**
   - `presets` is a signal, loaded once and shared app-wide. `loadError` is a signal too.
   - `save(list)` and `restoreDefaults()` (DELETE, then GET).
   - **Race safety:** writes go through one `concatMap` queue, so two quick edits can't arrive at
     the server out of order. The signal updates only after the server confirms, so the UI never
     shows a list that wasn't saved.
   - `label(preset)` returns the user name or the generated translated name.
4. **`shared/components/date-range-filter/` (new, generic, reusable by later views).**
   - `range = model<DateRange | null>()`.
   - Preset dropdown: CDK `cdkMenu` with `cdkMenuItemRadio`, following the user-menu pattern. Each
     item shows the label and the resolved dates. *All dates* is the last item.
   - Two native `<input type="date">` fields. Each one's `min`/`max` is bound to the other.
   - `selectedPresetId` is a signal. Typing a date clears it, and the trigger then shows *Custom
     range*.
   - **Initial value:** the first preset, resolved once the presets have loaded. This happens only
     while the user hasn't touched the picker, so a late load can't overwrite their choice.
   - Structural SCSS plus `--date-range-filter-*` tokens that default to global tokens.
5. **`<app-data-table>`.** Table features go into the component (per `CLAUDE.md`), named after
   ag-Grid's external filter:
   - `externalFilter = input<((row: Row) => boolean) | null>(null)`. `boundRows` filters raw rows
     with it before proxying. A range change gives `boundRows` a new identity, so PrimeNG resets
     to page 1, which is what we want. An in-place category change followed by `refresh()` still
     keeps the page.
   - A toolbar slot, `<ng-content select="[appDataTableToolbar]" />`, inside the `.filters` form
     after the search field.
   - Add a spec for both, and document both in `data-table.model.ts` and `docs/architecture.md`.
6. **`features/transactions/`** places
   `<app-date-range-filter appDataTableToolbar [(range)]="range" />` in the table and passes
   `[externalFilter]="dateFilter()"`. `dateFilter` is a `computed` returning
   `row => isInRange(row.datum, range)`, or `null` when there is no range. It filters on `datum`,
   the booking date.
7. **`features/settings/` (new) is a tabbed shell.** More settings will join the presets later, so
   the page is built around tabs from the start:
   - `settings.component` is the shell: page heading, a tab bar and a `<router-outlet>`. It is
     lazy-loaded at `/:locale/settings`, whose children are lazy-loaded too.
   - **The URL decides the active tab.** Each tab is a child route, `/:locale/settings/<tab>`, and
     bare `/settings` redirects to the first tab. Tabs are deep-linkable and survive reload, just
     as the locale lives in the URL.
   - Tabs are defined once as a `SETTINGS_TABS` array (`{ path, labelKey, loadComponent }`). Both
     the child routes and the tab bar derive from it (SPOT), so adding a tab means adding one
     entry.
   - The tab bar is a `<nav>` of `routerLink`s with `routerLinkActive` and
     `ariaCurrentWhenActive="page"`, the same pattern as the header nav. Because each tab
     navigates to its own route, these are links, not ARIA `tablist`/`tab` widgets, which CDK
     doesn't provide either. It scrolls horizontally at narrow widths and has
     `--settings-tabs-*` tokens.
   - **The first and only tab for now is *Date presets*** (`features/settings/date-presets/`). It
     holds the preset list and the inline editor, using `@angular/forms` reactive forms: name, a
     kind toggle, then either unit/offset/count or from/to, with a live preview of the resolved
     dates. Deleting needs no confirm dialog because *Restore defaults*
   exists. **The user menu** gets a *Settings* link item, because preferences belong in the user
   menu, not the nav (per `frontend.md`).
8. **i18n:** add every new key to both `en.json` and `de.json`. That covers the picker, the
   settings page, the units, the generated-name patterns and errors.
9. **Docs:** `docs/architecture.md` needs these updates:
   - Data model: one documented exception to "never owns the schema", namely `hf_user_setting`.
     The DB user then needs the `CREATE` privilege, which the dev container already grants.
   - API table: the three `/api/settings/date-presets` routes.
   - The new data-table options.
   - The `transactions-table` skill: the date filter.

## Execution (subagents, cheapest model and lowest reasoning that suffice)

**Reasoning effort.** The Agent tool takes a `model` override but no effort setting. A subagent's
effort comes only from its agent definition's frontmatter. So Phase 0 adds two user-level agent
definitions. They are generic, not project-specific, and live in `~/.claude/agents/`:

| Agent | Frontmatter | Used for |
|---|---|---|
| `implementer-light` | `model: haiku`, `effort: low`, tools: Read/Edit/Write/Bash/Grep/Glob | mechanical edits: wiring, i18n keys, ApiService methods, specs that follow an existing spec, docs |
| `implementer` | `model: sonnet`, `effort: medium`, all tools incl. Skill | design-heavy or edge-case-heavy code |

*This session couldn't load the new definitions; they take effect in the next session. Until then, phases run on `general-purpose` with the same model override, without the effort setting.*

Each prompt includes exact file paths, the relevant plan excerpt and the conventions to copy from a
named sibling file, so a low-effort agent doesn't have to rediscover context. Every agent runs
`pnpm lint` plus its package's tests before reporting back. The main session reviews every phase's
diff.

| Phase | Work | Agent | Order |
|---|---|---|---|
| 0 | Create the two agent definitions above | main session | first |
| A | Shared contract `user-settings.d.ts` | main session (tiny, everything depends on it) | after 0 |
| B1 | Backend: `user-setting` repo, `server.ts` startup, defaults + zod schema | `implementer-light` (follows the `umsatz.ts`/`transactions.ts` patterns) | parallel after A |
| B2 | Backend route spec | `implementer-light` | after B1 |
| C1 | `date-range.ts` + spec (calendar edge cases) | `implementer` (sonnet) | parallel after A |
| C2 | ApiService methods + `DatePresetService` (`concatMap` write queue) | `implementer` (sonnet, race-sensitive) | parallel after A |
| D | `<app-data-table>` `externalFilter` + toolbar slot + specs | `implementer` (sonnet: subtle PrimeNG identity/paging contract) | parallel after A |
| E | `<app-date-range-filter>` + transactions wiring. **Invokes `frontend-design:frontend-design` first** | `implementer` (sonnet) | after C1, C2, D |
| F1 | Settings tab shell (`SETTINGS_TABS`, child routes, tab bar) + *Date presets* tab with the preset editor. **Invokes `frontend-design:frontend-design` first** | `implementer` (sonnet) | after C1, C2 (parallel with E) |
| F2 | Route, user-menu *Settings* link and its i18n keys | `implementer-light` | after F1 |
| G | Docs (architecture.md, transactions-table skill) | `implementer-light` | after B–F |
| H | Quality gates + browser check, review | main session | last |

E and F1 each add their own i18n keys to both `en.json` and `de.json`, because `TranslationKey` is
compile-checked and their templates won't build without them.

Each phase in the plan file gets the Status/Started/Ended block from `plan-mode.md`.

**UI/UX phases (E, F) run through the `frontend-design:frontend-design` skill.** The agent's
prompt instructs it to call the Skill tool with `frontend-design:frontend-design` before it writes
any template or SCSS, and to follow that skill's process:
1. Draft a short design plan (tokens, type roles, an ASCII layout, principles). The *Design*
   section above is the brief and starting direction, not a finished spec.
2. Review the draft against the brief and against the generic-default traps.
3. Build within the project's constraints: theme tokens only, structural component SCSS,
   `--component-*` tokens, CDK menus, a11y, and `prefers-reduced-motion`.
4. Screenshot and critique in the browser: at least the default, greenbar and telex themes in light
   and dark, plus a narrow width.

Phase F reuses Phase E's design decisions, so the picker and the settings page read as one system.
Phase F's skill pass covers the settings-page layout and the preset editor. Each agent reports its
final design plan back to the main session for review in Phase H.

## Sub-phases

### Phase 0 — Agent definitions
- **Status:** done
- **Started:** 2026-10-01 21:30
- **Ended:** 2026-10-01 21:32

### Phase A — Shared contract
- **Status:** done
- **Started:** 2026-10-01 21:32
- **Ended:** 2026-10-01 21:33

### Phase B1 — Backend repo, defaults, schema, startup
- **Status:** done
- **Started:** 2026-10-01 21:40
- **Ended:** 2026-10-01 21:56

### Phase B2 — Backend route spec
- **Status:** done
- **Started:** 2026-10-01 22:05
- **Ended:** 2026-10-01 22:12

### Phase C1 — date-range util
- **Status:** done
- **Started:** 2026-10-01 21:40
- **Ended:** 2026-10-01 21:55

### Phase C2 — ApiService + DatePresetService
- **Status:** done
- **Started:** 2026-10-01 21:40
- **Ended:** 2026-10-01 21:55

### Phase D — data-table externalFilter + toolbar slot
- **Status:** done
- **Started:** 2026-10-01 21:40
- **Ended:** 2026-10-01 21:55

### Phase E — Date range filter + transactions wiring
- **Status:** done
- **Started:** 2026-10-01 21:56
- **Ended:** 2026-10-01 22:08

### Phase F1 — Settings tab shell + Date presets tab
- **Status:** done
- **Started:** 2026-10-01 21:56
- **Ended:** 2026-10-01 22:15

### Phase F2 — Settings route + user-menu link
- **Status:** done
- **Started:** 2026-10-01 21:56
- **Ended:** 2026-10-01 22:15

### Phase G — Docs
- **Status:** done
- **Started:** 2026-10-01 22:15
- **Ended:** 2026-10-01 22:45

### Phase H — Quality gates + browser check
- **Status:** done
- **Started:** 2026-10-01 22:15
- **Ended:** 2026-10-01 22:45

## Deviations from the plan

- **Limits contract.** The validation limits are pinned as literal types (`DatePresetLimits`) in the
  shared contract. Backend and frontend each declare a constant typed against it, so the two copies
  can't drift (SPOT).
- **Editor component.** The preset editor became its own component (`preset-editor/`), because
  `date-presets.component.scss` exceeded the 4 kB `anyComponentStyle` budget. The button styles are
  a shared mixin (`_preset-buttons.scss`).
- **`formatRange()`.** It lives in `core/utils/date-range.ts`, shared by the picker, the preset list
  and the editor.
- **Browser fixes found in the check.** The settings tab bar showed a stray vertical scrollbar
  (fixed with `overflow: auto hidden`). Disabled move arrows looked enabled (now `--surface-border`).
- **Out of scope, found while checking.**
  - The initial-bundle budget warning (630 kB at HEAD, 640 kB now; the growth is the new i18n keys)
    predates this work.
  - The header nav overflows at phone width.

## Verification

- `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build` all pass with no
  warnings.
- `pnpm start:local`, then check in the browser (Claude in Chrome):
  - Transactions opens on *Current month*, and the table shows only October 2026 bookings.
  - The dropdown items show their resolved dates. *Last year* shows 2025 bookings.
  - Editing a date by hand switches the trigger to *Custom range*. *All dates* shows every row.
  - Search still works on top of the range.
  - Changing a category keeps the current page.
  - Settings: `/de/settings` redirects to `/de/settings/date-presets`, the tab shows as active, and
    a reload stays on the tab.
  - Presets tab: add *Last 30 days* (relative day/0/30) and *Holiday 2025* (fixed), rename one,
    reorder, delete. Reload: the changes are still there, and the new first preset is the default.
  - Switching to German translates the generated names.
  - *Restore defaults* brings back the four defaults.
  - Check the default, greenbar and telex themes, each light and dark, plus a narrow (mobile) width.
- `SELECT * FROM hf_user_setting` shows exactly one row, keyed by the dev identity.
