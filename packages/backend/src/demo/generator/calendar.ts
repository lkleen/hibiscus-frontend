/** Dates as day numbers (days since 1970-01-01, UTC), so date maths never meets a time zone. */
export type Day = number;

const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dayOf(year: number, month: number, dayOfMonth: number): Day {
  return Date.UTC(year, month - 1, dayOfMonth) / MS_PER_DAY;
}

/** Parses `YYYY-MM-DD`; throws on anything else. */
export function parseDay(text: string): Day {
  const match: RegExpExecArray | null = DATE_PATTERN.exec(text);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${text}`);
  const day: Day = dayOf(Number(match[1]), Number(match[2]), Number(match[3]));
  if (formatDay(day) !== text) throw new Error(`Not a valid calendar date: ${text}`);
  return day;
}

export function formatDay(day: Day): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function yearOf(day: Day): number {
  return new Date(day * MS_PER_DAY).getUTCFullYear();
}

/** 1–12. */
export function monthOf(day: Day): number {
  return new Date(day * MS_PER_DAY).getUTCMonth() + 1;
}

export function dayOfMonth(day: Day): number {
  return new Date(day * MS_PER_DAY).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: Day): number {
  return new Date(day * MS_PER_DAY).getUTCDay();
}

export function isWeekend(day: Day): boolean {
  const wd: number = weekday(day);
  return wd === 0 || wd === 6;
}

export function daysInMonth(year: number, month: number): number {
  return dayOf(year, month + 1, 1) - dayOf(year, month, 1);
}

/** Banks book on working days: a weekend date moves to the next Monday. */
export function nextBusinessDay(day: Day): Day {
  let result: Day = day;
  while (isWeekend(result)) result++;
  return result;
}

/** The last working day of a month, e.g. the salary date. */
export function lastBusinessDay(year: number, month: number): Day {
  let result: Day = dayOf(year, month, daysInMonth(year, month));
  while (isWeekend(result)) result--;
  return result;
}

/** `MM/YYYY`, as used in purposes like "LOHN/GEHALT 03/2014". */
export function monthLabel(year: number, month: number): string {
  return `${String(month).padStart(2, '0')}/${year}`;
}

/** `DD.MM.YYYY`, the German date format used inside purposes. */
export function germanDate(day: Day): string {
  const iso: string = formatDay(day);
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
