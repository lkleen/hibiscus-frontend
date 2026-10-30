const SERVER_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Formats a backend timestamp (`YYYY-MM-DD HH:mm:ss`, server time zone) for `locale`. Throws on a
 * value of any other shape instead of showing a guess.
 */
export function formatSyncTime(value: string, locale: string): string {
  const match: RegExpExecArray | null = SERVER_TIMESTAMP.exec(value);
  if (!match) throw new Error(`Unexpected sync timestamp "${value}"`);
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date: Date = new Date(year, month - 1, day, hour, minute, second);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
