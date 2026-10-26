/**
 * Per-user settings the app stores itself, in its own `hf_user_setting` table (see
 * docs/architecture.md#data-model) — not Hibiscus data.
 *
 * Declared here once and imported by both packages; never re-declare it on either side.
 */

/** Calendar unit a relative date preset counts in. Weeks start on Monday (ISO 8601). */
export type DatePresetUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

interface DatePresetBase {
  /** Client-generated (`crypto.randomUUID()`), stable across edits. */
  id: string;
  /** User-given name; `null` means the UI shows a translated name generated from the definition. */
  name: string | null;
}

/**
 * `count` whole `unit` periods, the last of which is `offset` periods away from the current one
 * (`0` = the current period, `-1` = the previous one). Resolved against today's date whenever it is
 * applied, so it moves with time. Examples: current month = month/0/1, last year = year/-1/1,
 * last 30 days = day/0/30.
 */
export interface RelativeDatePreset extends DatePresetBase {
  kind: 'relative';
  unit: DatePresetUnit;
  offset: number;
  count: number;
}

/** A fixed, inclusive date range. Both dates are `YYYY-MM-DD`, `from <= to`. */
export interface FixedDatePreset extends DatePresetBase {
  kind: 'fixed';
  from: string;
  to: string;
}

export type DatePreset = RelativeDatePreset | FixedDatePreset;

/**
 * Body of `PUT /api/settings/date-presets` and response of `GET /api/settings/date-presets`: the
 * user's whole, ordered preset list. The first preset is the one every date range filter starts on.
 */
export type DatePresetList = DatePreset[];

/**
 * Validation limits of `PUT /api/settings/date-presets`, pinned as literal types: this package is
 * types-only, so each side declares its own runtime constant typed `DatePresetLimits`, and a value
 * that differs from these fails typecheck on that side. Change a limit here, and both sides must
 * follow. `minCount` is 1 and the newest period is at most the current one (offset ≤ 0).
 */
export interface DatePresetLimits {
  readonly maxPresets: 50;
  readonly maxIdLength: 64;
  readonly maxNameLength: 80;
  readonly minCount: 1;
  readonly maxCount: 366;
  /** Largest number of periods the newest period may lie in the past (`offset >= -maxAgo`). */
  readonly maxAgo: 100;
}

/**
 * How dense a table is rendered (font size and cell padding; the values live in the frontend's
 * `_primeng-table.scss`). Chosen per table view, see `TableDensities`.
 *
 * Types-only, so each side declares its own runtime list of the ids, checked against this union
 * so a missing or extra id fails typecheck on that side.
 */
export type TableDensity = 'extra-compact' | 'compact' | 'normal' | 'comfortable' | 'spacious';

/** The table views whose density the user picks (in their ribbon's View tab). */
export type TableViewId = 'transactions-list' | 'transactions-by-category' | 'categories';

/**
 * The user's density per table view. Body of `PUT /api/settings/table-densities` and response of
 * `GET /api/settings/table-densities`; a view that is missing is rendered `normal`.
 */
export type TableDensities = Partial<Record<TableViewId, TableDensity>>;

/**
 * A yes/no question about the user's life situation that switches tax-return sections on or off
 * (the frontend's `TAX_SECTIONS` names the situation each section depends on).
 *
 * Types-only, so each side declares its own runtime list of the ids, checked against this union.
 */
export type TaxSituation = 'employed' | 'children' | 'household' | 'rental' | 'donations';

/**
 * The user's tax-return profile. Body of `PUT /api/settings/tax-profile` and response of
 * `GET /api/settings/tax-profile`.
 */
export interface TaxProfile {
  /** Answer per situation; `null` = not answered yet (the section stays visible). */
  situations: Record<TaxSituation, boolean | null>;
  /** Tax year whose seasonal hint the user dismissed; `null` = never dismissed. */
  hintDismissedYear: number | null;
}
