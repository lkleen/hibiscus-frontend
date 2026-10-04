**Status:** done

# Date range filter: previous / next period stepping

## Context

The transactions table toolbar has `<app-date-range-filter>` (Period preset menu + From/To date
inputs). The user wants to page through time without opening the preset menu: a ◀ previous and
▶ next icon button, plus a dropdown choosing the step unit (day, week, month, quarter, year).

Decisions (confirmed with the user):
- **Jump to the adjacent calendar period**: the range becomes exactly one whole period of the step
  unit. ◀ = the period *before* the one containing `from`; ▶ = the period *after* the one containing
  `to`. Oct 2026 + month → ◀ Sep 1–30 / ▶ Nov 1–30. A custom 2026-08-15 – 2026-10-31 → ◀ July.
  Open end: the missing end falls back to the other end; "All dates" (both open) anchors on today.
- **Step unit is session-only state** of the filter component (no backend). It follows the selected
  relative preset's unit (e.g. "current month" → month), otherwise keeps its last value; initial
  `month`. The user can always override it via the dropdown.
- **All five `DatePresetUnit`s** incl. quarter, reusing `settings.unit.*` labels.

After a step the range belongs to no preset → trigger label shows "Custom range" (same as typing).

## Changes

### 1. `core/utils/date-range.ts` (+ spec)
- Export `DATE_PRESET_UNITS: readonly DatePresetUnit[]` (moved from
  `preset-editor.component.ts:103`, which now imports it — SPOT, second use).
- Refactor `resolveRelative` to take the plain period definition
  `{ unit, offset, count }` (a `RelativePeriod` type = `Pick<RelativeDatePreset, 'unit' | 'offset' | 'count'>`)
  so it can be reused without a fake preset; `resolvePreset` keeps its signature.
- Add `parseIsoDate(iso: string): Date` (local `new Date(y, m - 1, d)`, throws on malformed input).
- Add `adjacentPeriod(range: DateRange | null, step: PeriodStep, today: Date): DateRange` where
  `PeriodStep = { unit: DatePresetUnit; direction: -1 | 1 }`. Anchor = `from` (◀) / `to` (▶),
  falling back to the other end, then `today`; returns `resolveRelative({ unit, offset: direction, count: 1 }, anchor)`.
- Spec cases: month (incl. 31st → Feb end / leap year), week (Monday-based, across year boundary),
  quarter, year, day; custom range anchors (`from` for ◀, `to` for ▶); half-open and `null` ranges.

### 2. `shared/components/date-range-filter/` (ts, html, scss, spec)
- **Invoke `frontend-design:frontend-design` first** (UI step, per memory).
- TS: `stepUnit = linkedSignal<DatePreset | null, DatePresetUnit>({ source: selectedPreset,
  computation: (p, prev) => p?.kind === 'relative' ? p.unit : prev?.value ?? 'month' })`;
  `units = DATE_PRESET_UNITS`; `step(direction)` → `touched.set(true)`, `selectedPresetId.set(null)`,
  `typedRange = undefined`, `range.set(adjacentPeriod(this.range(), { unit, direction }, new Date()))`
  (the existing effect mirrors it into the inputs); `onStepUnitChange(event)` sets `stepUnit`.
- HTML: a new `date-range-filter__field` after "To", label "Step" (`dateRangeFilter.step`, `for` the
  select), containing a `.date-range-filter__stepper` group: `‹` icon button
  (`aria-label` `dateRangeFilter.previous`, inline chevron-left SVG `aria-hidden`), native
  `<select>` over `units` with `settings.unit.*` labels (`[value]` bound — no typing issue for
  selects), `›` icon button (`dateRangeFilter.next`). Native `<select>` follows the preset editor's
  unit field precedent.
- SCSS: structural only; buttons/select reuse the existing field token block
  (`--date-range-filter-field-*`, radius, focus-visible, `pointer: coarse` 44px min size); stepper
  is `display: flex; gap: 0.25rem` (dense button group). Square icon buttons via padding.
- Spec: ◀/▶ change `range` to the adjacent month after loading presets (preset `b` = current
  month, so step unit follows → month); changing the select to `year` steps by year; trigger label
  becomes "Custom range"; From/To inputs show the new dates; All dates + ◀ = previous period from
  today (stub `Date` via `vi.useFakeTimers`/`setSystemTime`).

### 3. i18n — `src/i18n/en.json` + `de.json`
`dateRangeFilter.step` (Step / Schritt), `dateRangeFilter.previous` (Previous period / Vorheriger
Zeitraum), `dateRangeFilter.next` (Next period / Nächster Zeitraum).

### 4. Docs
`docs/architecture.md` Transactions table paragraph: one sentence on ◀/▶ stepping with a
session-only step unit. Persist this plan to `docs/plans/20261004-date-range-stepper-<status>.md`.

No changes to `transactions.component.*` — it already binds `[(range)]`, and the table filter
reacts to the model.

## Phases

### Phase A — date-range utils (step 1)
- **Status:** done
- **Started:** 2026-10-04 12:57
- **Ended:** 2026-10-04 12:59

### Phase B — i18n keys (step 3)
- **Status:** done
- **Started:** 2026-10-04 12:57
- **Ended:** 2026-10-04 12:59

### Phase C — filter component stepper (step 2)
- **Status:** done
- **Started:** 2026-10-04 12:57
- **Ended:** 2026-10-04 13:04

### Phase D — docs (step 4)
- **Status:** done
- **Started:** 2026-10-04 12:58
- **Ended:** 2026-10-04 12:58

## Execution

| Step | Agent | Model/effort | Wave | Write set | Reads |
|---|---|---|---|---|---|
| 1 date-range utils + spec, preset-editor import | implementer-light | sonnet / low | 1 | `core/utils/date-range{,.spec}.ts`, `preset-editor.component.ts` | date-range.ts |
| 3 i18n keys | implementer-light | haiku / low | 1 | `i18n/en.json`, `i18n/de.json` | — |
| 2 filter component + spec (frontend-design first) | implementer | sonnet / medium | 2 | `date-range-filter.component.*` | step 1 API, component files |
| 4 docs | main | — | 2 | `docs/architecture.md`, `docs/plans/…` | — |

## Verification
- `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build` from repo root.
- `pnpm start:local`, open `/de/transactions`: with "current month" preset, ◀ shows previous
  month and the table filters to it, ▶ goes forward; switch step to Week/Year and step; check the
  label switches to "Custom range", keyboard focus rings, and the five themes in light + dark.
