import { crc32 } from 'node:zlib';

/**
 * A TypeScript port of the parts of Hibiscus (https://github.com/willuhn/hibiscus, master) that
 * decide whether two `umsatz` rows are "the same": `UmsatzImpl.getChecksum` and the purpose
 * handling of `VerwendungszweckUtil` it depends on. Rows this app inserts must carry the checksum
 * the desktop Hibiscus would compute, or either side would insert the other's bookings again.
 *
 * Java string semantics are reproduced where they differ from JavaScript: `String.trim` only
 * strips chars <= U+0020, `Character.isWhitespace` is narrower than `\s`, `String.split` drops
 * trailing empty strings, string concatenation renders `null` as "null", and `Double.toString`
 * formats doubles differently from `Number.prototype.toString`.
 */

/** `Umsatz.FLAG_NOTBOOKED` — a pending ("vorgemerkt") booking. */
export const FLAG_NOTBOOKED = 2;

/** `HBCIProperties.HBCI_TRANSFER_USAGE_DB_MAXLENGTH` (default): max length of zweck2/zweck3 lines. */
export const USAGE_DB_MAXLENGTH = 35;

/** The three purpose columns of `umsatz`. `zweck3` holds the further lines, each + "\n". */
export interface UmsatzPurpose {
  zweck: string | null;
  zweck2: string | null;
  zweck3: string | null;
}

/** The `umsatz` columns `UmsatzImpl.getChecksum` reads. Dates are `yyyy-MM-dd`. */
export interface ChecksumFields extends UmsatzPurpose {
  kontoId: number;
  art: string | null;
  betrag: number;
  customerref: string | null;
  empfaengerBlz: string | null;
  empfaengerKonto: string | null;
  empfaengerName: string | null;
  primanota: string | null;
  datum: string;
  valuta: string;
  flags: number | null;
}

// ---------------------------------------------------------------------------------------------
// Java string semantics

/** Unicode space, line and paragraph separators. */
const UNICODE_SEPARATOR = /^[\p{Zs}\p{Zl}\p{Zp}]$/u;

/** The separators `Character.isWhitespace` excludes: U+00A0, U+2007, U+202F (non-breaking). */
const NON_BREAKING_SPACES: number[] = [0x00a0, 0x2007, 0x202f];

/** Java's `.` in a regex: anything except the line terminators. */
const JAVA_DOT = '[^\\n\\r\\u0085\\u2028\\u2029]';

/** `java.lang.Character.isWhitespace`: \t \n VT \f \r, U+001C-U+001F and breaking separators. */
function isJavaWhitespace(char: string): boolean {
  const code: number = char.charCodeAt(0);
  if ((code >= 0x09 && code <= 0x0d) || (code >= 0x1c && code <= 0x1f)) return true;
  return UNICODE_SEPARATOR.test(char) && !NON_BREAKING_SPACES.includes(code);
}

/** `java.lang.String.trim`: strips chars <= U+0020 from both ends (not Unicode whitespace). */
export function javaTrim(text: string): string {
  let start = 0;
  let end: number = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start++;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end--;
  return text.substring(start, end);
}

/** `de.willuhn.jameica.hbci.util.StringUtils.trimToEmpty` */
export function trimToEmpty(text: string | null | undefined): string {
  return text === null || text === undefined ? '' : javaTrim(text);
}

/** `de.willuhn.jameica.hbci.util.StringUtils.isBlank` */
export function isBlank(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return true;
  return [...text].every((char: string): boolean => isJavaWhitespace(char));
}

/** `de.willuhn.jameica.hbci.util.StringUtils.deleteWhitespace` */
export function deleteWhitespace(text: string): string {
  return [...text].filter((char: string): boolean => !isJavaWhitespace(char)).join('');
}

/** `java.lang.String.split` with a literal separator: trailing empty strings are dropped. */
function javaSplit(text: string, separator: string): string[] {
  const parts: string[] = text.split(separator);
  if (parts.length === 1) return parts; // no match: Java returns the input itself, even ""
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** `java.lang.String.substring`, which throws where JavaScript would clamp or swap. */
function javaSubstring(text: string, begin: number, end: number = text.length): string {
  if (begin < 0 || end > text.length || begin > end) {
    throw new RangeError(`substring(${begin}, ${end}) out of range for length ${text.length}`);
  }
  return text.substring(begin, end);
}

/** `"" + s` in Java: `null` becomes the string "null". */
function javaConcat(value: string | null): string {
  return value === null ? 'null' : value;
}

/** `java.lang.Double.toString(double)` */
export function javaDoubleToString(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const sign: string = value < 0 ? '-' : '';
  const magnitude: number = Math.abs(value);
  if (magnitude >= 1e-3 && magnitude < 1e7) {
    // JavaScript prints this range in plain notation with the same shortest digits.
    const plain = String(magnitude);
    return sign + (plain.includes('.') ? plain : `${plain}.0`);
  }
  // Computerized scientific notation: "d.ddd" + "E" + exponent, at least one fraction digit.
  const [mantissa, exponent] = magnitude.toExponential().split('e') as [string, string];
  const digits: string = mantissa.includes('.') ? mantissa : `${mantissa}.0`;
  return `${sign}${digits}E${Number(exponent)}`;
}

/** `HBCI.DATEFORMAT` (`dd.MM.yyyy`) for a `yyyy-MM-dd` date. */
export function formatHibiscusDate(isoDate: string): string {
  const match: RegExpExecArray | null = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Invalid date "${isoDate}", expected yyyy-MM-dd`);
  return `${match[3]}.${match[2]}.${match[1]}`;
}

// ---------------------------------------------------------------------------------------------
// VerwendungszweckUtil

/** `VerwendungszweckUtil.clean(boolean, List)`: drops nulls and empty lines, optionally trims. */
function cleanLines(trim: boolean, lines: readonly (string | null)[]): string[] {
  const result: string[] = [];
  for (const raw of lines) {
    if (raw === null) continue;
    const line: string = trim ? javaTrim(raw) : raw;
    if (line.length > 0) result.push(line);
  }
  return result;
}

/** `VerwendungszweckUtil.split(String)`: the `zweck3` column into its lines. */
export function splitLines(lines: string | null): string[] {
  if (lines === null || lines.length === 0) return [];
  return javaSplit(lines, '\n');
}

/** Cuts `text` into pieces of `width` chars, like Hibiscus's `replaceAll("(.{n})", ...)`. */
function chunk(text: string, width: number): string[] {
  const marker = '--##--##';
  const marked: string = text.replace(new RegExp(`(${JAVA_DOT}{${width}})`, 'g'), `$1${marker}`);
  return javaSplit(marked, marker);
}

/** `VerwendungszweckUtil.parse(String)`: an unstructured purpose block into 27-char lines. */
export function parseFixedWidth(line: string | null): string[] {
  if (line === null || line.length === 0) return [];
  return chunk(line, 27);
}

/** `VerwendungszweckUtil.rewrap(int, String...)`: re-cut all lines if any is longer than limit. */
export function rewrap(limit: number, lines: string[]): string[] {
  if (lines.length === 0) return lines;
  if (!lines.some((line: string): boolean => line.length > limit)) return lines;
  return chunk(cleanLines(true, lines).join(''), limit);
}

/** `VerwendungszweckUtil.merge(String...)`: every line followed by "\n", null if none. */
export function mergeLines(lines: readonly (string | null)[]): string | null {
  if (lines.length === 0) return null;
  const result: string = cleanLines(false, lines)
    .map((line: string): string => `${line}\n`)
    .join('');
  return result.length === 0 ? null : result;
}

/** `VerwendungszweckUtil.toArray(Transfer)`: zweck, zweck2 and the zweck3 lines, cleaned. */
export function purposeToArray(purpose: UmsatzPurpose): string[] {
  return cleanLines(false, [purpose.zweck, purpose.zweck2, ...splitLines(purpose.zweck3)]);
}

/** `VerwendungszweckUtil.toString(Transfer)`: all purpose lines joined by a space. */
export function purposeToString(purpose: UmsatzPurpose): string {
  return purposeToArray(purpose).join(' ').replaceAll('\n', ' ');
}

/**
 * `VerwendungszweckUtil.apply(HibiscusTransfer, String[])` together with
 * `UmsatzImpl.setWeitereVerwendungszwecke`: line 1 -> zweck, line 2 -> zweck2, the rest merged
 * into zweck3 (cut at 1000 chars).
 */
export function applyPurpose(lines: string[]): UmsatzPurpose {
  const cleaned: string[] = cleanLines(true, lines);
  const zweck: string | null = cleaned.shift() ?? null;
  const zweck2: string | null = cleaned.shift() ?? null;
  let zweck3: string | null = cleaned.length > 0 ? mergeLines(cleaned) : null;
  if (zweck3 !== null && zweck3.length > 1000) zweck3 = zweck3.substring(0, 1000);
  return { zweck, zweck2, zweck3 };
}

/** `VerwendungszweckUtil.Tag`, in declaration order (the parser iterates in this order). */
export const SEPA_TAGS = [
  'EREF',
  'KREF',
  'MREF',
  'CRED',
  'DBET',
  'SVWZ',
  'ABWA',
  'IBAN',
  'BIC',
  'TAN1',
  'TAN',
] as const;
export type SepaTag = (typeof SEPA_TAGS)[number];

function tagByName(name: string): SepaTag | null {
  return SEPA_TAGS.find((tag: SepaTag): boolean => tag === name) ?? null;
}

/** `VerwendungszweckUtil.parse(char, String...)` */
function parseTagsWith(separator: string, lines: string[]): Map<SepaTag, string> {
  const result: Map<SepaTag, string> = new Map<SepaTag, string>();
  if (lines.length === 0) return result;
  // Java hits a NullPointerException here when merge() yields null and its catch returns the
  // still empty result; returning it directly is the same outcome.
  const line: string | null = mergeLines(lines);
  if (line === null) return result;
  let first = -1;
  for (const tag of SEPA_TAGS) {
    const start: number = line.indexOf(tag + separator);
    if (start === -1) continue;
    if (first === -1 || start < first) first = start;
    const tagLength: number = tag.length + 1;
    let next = 0;
    while (next < line.length) {
      // Java adds the previous absolute position to the search start; ported as is.
      next = line.indexOf(separator, start + tagLength + next);
      if (next === -1) {
        result.set(tag, trimToEmpty(javaSubstring(line, start + tagLength).replaceAll('\n', '')));
        break;
      }
      const found: SepaTag | null =
        tagByName(javaSubstring(line, next - 4, next)) ??
        tagByName(javaSubstring(line, next - 3, next));
      if (found !== null) {
        const value: string = javaSubstring(line, start + tagLength, next - found.length);
        result.set(tag, trimToEmpty(value.replaceAll('\n', '')));
        break;
      }
    }
  }
  if (result.size > 0 && !result.has('SVWZ') && first > 0) {
    result.set('SVWZ', trimToEmpty(javaSubstring(line, 0, first).replaceAll('\n', '')));
  }
  const iban: string = trimToEmpty(result.get('IBAN'));
  if (iban.length > 0) {
    const space: number = iban.indexOf(' ');
    if (space > 21) result.set('IBAN', trimToEmpty(iban.substring(0, space)));
    else if (space !== -1) result.set('IBAN', deleteWhitespace(iban));
  }
  const bic: string = trimToEmpty(result.get('BIC'));
  if (bic.length > 0) result.set('BIC', deleteWhitespace(bic));
  return result;
}

/** `VerwendungszweckUtil.parse(String...)`: "+" tags first, ":" tags as fallback and in SVWZ. */
export function parseTags(lines: string[]): Map<SepaTag, string> {
  const result: Map<SepaTag, string> = parseTagsWith('+', lines);
  if (result.size === 0) return parseTagsWith(':', lines);
  const svwz: string | undefined = result.get('SVWZ');
  if (!isBlank(svwz)) {
    for (const [tag, value] of parseTagsWith(':', [svwz as string])) result.set(tag, value);
  }
  return result;
}

/** `VerwendungszweckUtil.getTag(Transfer, Tag)` */
export function getTag(purpose: UmsatzPurpose, tag: SepaTag): string | null {
  const result: Map<SepaTag, string> = parseTags(purposeToArray(purpose));
  if (result.size === 0) return tag === 'SVWZ' ? purposeToString(purpose) : null;
  const value: string | null = result.get(tag) ?? null;
  if (tag === 'SVWZ' && isBlank(value)) return purposeToString(purpose);
  return value;
}

// ---------------------------------------------------------------------------------------------
// UmsatzImpl.getChecksum

/**
 * The string `UmsatzImpl.getChecksum` hashes (with the default setting
 * `umsatz.checksum.saldo=false`, so the balance is not part of it).
 */
export function checksumSource(fields: ChecksumFields): string {
  if (!Number.isInteger(fields.kontoId)) throw new Error(`Invalid konto id ${fields.kontoId}`);
  if (!Number.isFinite(fields.betrag)) throw new Error(`Invalid betrag ${fields.betrag}`);
  let source: string =
    javaConcat(fields.art).toUpperCase() +
    String(fields.kontoId) +
    javaDoubleToString(fields.betrag) +
    javaConcat(fields.customerref) +
    javaConcat(fields.empfaengerBlz) +
    javaConcat(fields.empfaengerKonto) +
    javaConcat(fields.empfaengerName).toUpperCase() +
    javaConcat(fields.primanota) +
    purposeToString(fields).toUpperCase() +
    formatHibiscusDate(fields.datum) +
    formatHibiscusDate(fields.valuta);
  if (((fields.flags ?? 0) & FLAG_NOTBOOKED) === FLAG_NOTBOOKED) source += 'notbooked';
  return source;
}

/**
 * `UmsatzImpl.getChecksum`: unsigned CRC32 over the bytes of `checksumSource`. Java encodes with
 * the platform charset (`String.getBytes()`), which is UTF-8 from Java 18 on — what the desktop
 * uses today (verified against its stored checksums, see `scripts/verify-hibiscus-checksums.ts`).
 * Every row this app inserts carries this checksum.
 */
export function computeChecksum(fields: ChecksumFields): number {
  return crc32(Buffer.from(checksumSource(fields), 'utf8'));
}

/** windows-1252 bytes 0x80..0x9F as code points; 0 marks the five bytes it leaves undefined. */
const CP1252_HIGH: number[] = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
  0x203a, 0x0153, 0, 0x017e, 0x0178,
];

/** Java's `String.getBytes("windows-1252")`: unmappable chars become '?'. */
function encodeCp1252(text: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code: number = text.charCodeAt(i);
    const high: number = code === 0 ? -1 : CP1252_HIGH.indexOf(code);
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else if (high !== -1) bytes.push(0x80 + high);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

/**
 * The checksum an older desktop installation stored: Java before 18 on Windows encoded with
 * windows-1252. The desktop's stored checksums switch from this to UTF-8 in April 2026; rows
 * inserted before carry this variant (it differs from `computeChecksum` only for non-ASCII text).
 * Used solely to recognise such rows as already present, never written.
 */
export function computeLegacyChecksum(fields: ChecksumFields): number {
  return crc32(encodeCp1252(checksumSource(fields)));
}
