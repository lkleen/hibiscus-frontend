import type {
  DatePreset,
  DatePresetUnit,
  RelativeDatePreset,
} from '@hibiscus-frontend/shared/contracts/user-settings';

/** Inclusive ISO `YYYY-MM-DD` range; `null` means that end is open. */
export interface DateRange {
  readonly from: string | null;
  readonly to: string | null;
}

/** All preset units, in ascending order of length. */
export const DATE_PRESET_UNITS: readonly DatePresetUnit[] = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

/** The period definition of a relative preset, without its identity. */
export type RelativePeriod = Pick<RelativeDatePreset, 'unit' | 'offset' | 'count'>;

/** One step to the previous (-1) or next (+1) whole calendar period of `unit`. */
export interface PeriodStep {
  readonly unit: DatePresetUnit;
  readonly direction: -1 | 1;
}

/** Parses a local-calendar ISO `YYYY-MM-DD` date; throws on anything else. */
export function parseIsoDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid ISO date: ${iso}`);
  const [year, month, day]: number[] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Local calendar date, not `toISOString()` — that is UTC and shifts the day around midnight. */
export function toIsoDate(date: Date): string {
  const year: string = String(date.getFullYear()).padStart(4, '0');
  const month: string = String(date.getMonth() + 1).padStart(2, '0');
  const day: string = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * All arithmetic goes through `new Date(y, m, d)`, which normalises overflow (day 0 = last day of
 * the previous month, month 12 = January next year) and is immune to DST shifts, unlike adding
 * milliseconds.
 */
function resolveRelative(preset: RelativePeriod, today: Date): DateRange {
  const { unit, offset, count }: RelativePeriod = preset;
  if (!Number.isInteger(offset))
    throw new Error(`Date preset offset must be an integer: ${offset}`);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Date preset count must be a positive integer: ${count}`);
  }
  const year: number = today.getFullYear();
  const month: number = today.getMonth();
  const day: number = today.getDate();
  const last: number = offset; // period index of the newest period
  const first: number = offset - (count - 1); // period index of the oldest period

  switch (unit) {
    case 'day':
      return range(new Date(year, month, day + first), new Date(year, month, day + last));
    case 'week': {
      const monday: number = day - ((today.getDay() + 6) % 7); // ISO: weeks start Monday
      return range(
        new Date(year, month, monday + first * 7),
        new Date(year, month, monday + last * 7 + 6),
      );
    }
    case 'month':
      return range(new Date(year, month + first, 1), new Date(year, month + last + 1, 0));
    case 'quarter': {
      const quarterStart: number = Math.floor(month / 3) * 3;
      return range(
        new Date(year, quarterStart + first * 3, 1),
        new Date(year, quarterStart + last * 3 + 3, 0),
      );
    }
    case 'year':
      return range(new Date(year + first, 0, 1), new Date(year + last, 11, 31));
    default: {
      const unreachable: never = unit;
      throw new Error(`Unknown date preset unit: ${String(unreachable)}`);
    }
  }
}

function range(from: Date, to: Date): DateRange {
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

/** Resolves a preset to concrete dates against `today` (local calendar). */
export function resolvePreset(preset: DatePreset, today: Date): DateRange {
  switch (preset.kind) {
    case 'fixed':
      return { from: preset.from, to: preset.to };
    case 'relative':
      return resolveRelative(preset, today);
    default: {
      const unreachable: never = preset;
      throw new Error(`Unknown date preset kind: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * The whole calendar period of `step.unit` before (-1) or after (+1) the range. Anchors on the
 * range's `from` when stepping back and on its `to` when stepping forward (falling back to the
 * other end, then to `today`).
 */
export function adjacentPeriod(range: DateRange | null, step: PeriodStep, today: Date): DateRange {
  const preferred: string | null =
    step.direction === -1 ? (range?.from ?? null) : (range?.to ?? null);
  const fallback: string | null =
    step.direction === -1 ? (range?.to ?? null) : (range?.from ?? null);
  const anchorIso: string | null = preferred ?? fallback;
  const anchor: Date = anchorIso === null ? today : parseIsoDate(anchorIso);
  return resolveRelative({ unit: step.unit, offset: step.direction, count: 1 }, anchor);
}

/** ISO dates sort lexically, so plain string comparison is a correct date comparison. */
export function isInRange(isoDate: string, range: DateRange): boolean {
  if (range.from !== null && isoDate < range.from) return false;
  if (range.to !== null && isoDate > range.to) return false;
  return true;
}

/** `from – to` for display; a date preset always resolves to a closed range. */
export function formatRange(range: DateRange): string {
  if (range.from === null || range.to === null) {
    throw new Error('A date preset always resolves to a closed range');
  }
  return `${range.from} – ${range.to}`;
}
