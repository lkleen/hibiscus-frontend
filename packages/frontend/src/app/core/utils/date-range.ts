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
function resolveRelative(preset: RelativeDatePreset, today: Date): DateRange {
  const { unit, offset, count }: { unit: DatePresetUnit; offset: number; count: number } = preset;
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
