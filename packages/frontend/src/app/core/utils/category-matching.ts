import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';

export interface CategoryAssignmentInput {
  readonly transactions: readonly TransactionRow[];
  readonly categories: readonly CategoryRow[];
  readonly accountsById: ReadonlyMap<number, AccountRow>;
}

export interface CategoryAssignment {
  /** Every transaction id → its category, or null when unassigned. */
  readonly byTransactionId: ReadonlyMap<number, CategoryRow | null>;
  /** Categories whose regex pattern does not compile (they never match). */
  readonly invalidPatterns: readonly CategoryRow[];
}

/** The searchable values of one transaction, trimmed as Hibiscus does. */
interface Fields {
  readonly zweck: string;
  readonly name: string;
  readonly name2: string;
  readonly kto: string;
  readonly kom: string;
  readonly art: string;
  readonly purp: string;
  readonly e2eid: string;
  readonly mid: string;
  readonly cid: string;
  readonly ref: string;
}

export interface CompiledCategory {
  readonly category: CategoryRow;
  readonly regex: RegExp | null;
  readonly terms: readonly string[];
}

const WHITESPACE = /\s/g;
const UNESCAPED_COMMA = /(?<!\\),/;
const TYPE_EXPENSE = 0;
const TYPE_INCOME = 1;

function trimmed(value: string | null): string {
  return (value ?? '').trim();
}

function nonEmpty(value: string | null): value is string {
  return value !== null && value !== '';
}

function toFields(t: TransactionRow): Fields {
  // zweck lines are concatenated with '' and newlines removed; the lines themselves are not trimmed.
  const zweck: string = [t.zweck, t.zweck2, t.zweck3]
    .filter((line: string | null): line is string => line !== null)
    .join('')
    .replace(/\n/g, '');
  return {
    zweck,
    name: trimmed(t.empfaenger_name),
    name2: trimmed(t.empfaenger_name2),
    kto: trimmed(t.empfaenger_konto),
    kom: trimmed(t.kommentar),
    art: trimmed(t.art),
    purp: trimmed(t.purposecode),
    e2eid: trimmed(t.endtoendid),
    mid: trimmed(t.mandateid),
    cid: trimmed(t.creditorid),
    ref: trimmed(t.customerref),
  };
}

export function compareCategories(a: CategoryRow, b: CategoryRow): number {
  // MySQL's default collation is case-insensitive but accent-sensitive here, like `sensitivity: 'accent'`.
  const byNumber: number = (a.nummer ?? '').localeCompare(b.nummer ?? '', undefined, {
    sensitivity: 'accent',
  });
  if (byNumber !== 0) return byNumber;
  const byName: number = a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' });
  return byName !== 0 ? byName : a.id - b.id;
}

/**
 * Java `matches()` is a full match, emulated by anchoring. Java and JS regex dialects differ
 * (possessive quantifiers, `\p{Alpha}`-style classes, inline flags other than the leading ones, ...);
 * a Java-only construct is reported as invalid here.
 */
export function compileCategory(
  category: CategoryRow,
): CompiledCategory | { readonly invalid: true; readonly category: CategoryRow } {
  const pattern: string = category.pattern ?? '';
  if (pattern.trim() === '') return { category, regex: null, terms: [] };
  if (category.isregex === 1) {
    try {
      return { category, regex: new RegExp('^(?:' + pattern + ')$', 'i'), terms: [] };
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) throw error;
      return { invalid: true, category };
    }
  }
  const terms: string[] = pattern
    .toLowerCase()
    .split(UNESCAPED_COMMA)
    .map((term: string) => term.trim().replace(/\\/g, '').replace(WHITESPACE, ''))
    .filter((term: string) => term !== '');
  return { category, regex: null, terms };
}

function typeAccepts(category: CategoryRow, betrag: number): boolean {
  if (betrag === 0) return true;
  if (betrag < 0 && category.umsatztyp === TYPE_INCOME) return false;
  if (betrag > 0 && category.umsatztyp === TYPE_EXPENSE) return false;
  return true;
}

function accountAccepts(category: CategoryRow, t: TransactionRow, account: AccountRow): boolean {
  if (category.konto_id !== null && category.konto_id !== t.konto_id) return false;
  if (nonEmpty(category.konto_kategorie) && category.konto_kategorie !== account.kategorie) {
    return false;
  }
  return true;
}

/** The fields in Hibiscus's order, which is also the order of its joined `mAll` text. */
function fieldValues(f: Fields): readonly string[] {
  return [f.name, f.name2, f.kto, f.zweck, f.kom, f.art, f.purp, f.e2eid, f.mid, f.cid, f.ref];
}

function regexMatches(regex: RegExp, values: readonly string[]): boolean {
  return regex.test(values.join(' ')) || values.some((value: string) => regex.test(value));
}

/** Lowercased once per transaction; whitespace stripped from name, name2 and zweck (Hibiscus's
 *  default `search.ignore.whitespace=true`). */
function termValues(f: Fields): readonly string[] {
  const stripped = (value: string): string => value.toLowerCase().replace(WHITESPACE, '');
  return [
    stripped(f.zweck),
    stripped(f.name),
    stripped(f.name2),
    ...[f.kto, f.kom, f.art, f.purp, f.e2eid, f.mid, f.cid, f.ref].map((value: string) =>
      value.toLowerCase(),
    ),
  ];
}

function termsMatch(terms: readonly string[], values: readonly string[], id: number): boolean {
  const idText = String(id);
  return terms.some(
    (term: string) => term === idText || values.some((value: string) => value.includes(term)),
  );
}

/** A transaction's fields, computed once and shared by every category tested against it. */
interface Candidate {
  readonly transaction: TransactionRow;
  readonly account: AccountRow;
  readonly fields: Fields;
  readonly values: readonly string[];
  lowered: readonly string[] | null;
}

function toCandidate(transaction: TransactionRow, account: AccountRow): Candidate {
  const fields: Fields = toFields(transaction);
  return { transaction, account, fields, values: fieldValues(fields), lowered: null };
}

function candidateMatches(c: CompiledCategory, candidate: Candidate): boolean {
  const { transaction: t, account } = candidate;
  if (!typeAccepts(c.category, t.betrag) || !accountAccepts(c.category, t, account)) return false;
  if (c.regex !== null) return regexMatches(c.regex, candidate.values);
  if (c.terms.length === 0) return false;
  candidate.lowered ??= termValues(candidate.fields);
  return termsMatch(c.terms, candidate.lowered, t.id);
}

/** Type + account scope + pattern, exactly as in the assignment loop; an empty pattern never matches. */
export function matchesCategory(
  compiled: CompiledCategory,
  transaction: TransactionRow,
  account: AccountRow,
): boolean {
  return candidateMatches(compiled, toCandidate(transaction, account));
}

/** Assigns each transaction to a category exactly like Hibiscus (`UmsatzImpl.getUmsatzTyp`). */
export function assignCategories(input: CategoryAssignmentInput): CategoryAssignment {
  const invalidPatterns: CategoryRow[] = [];
  const compiled: CompiledCategory[] = [];
  for (const category of [...input.categories].sort(compareCategories)) {
    const result: ReturnType<typeof compileCategory> = compileCategory(category);
    if ('invalid' in result) {
      invalidPatterns.push(category);
      compiled.push({ category, regex: null, terms: [] });
    } else {
      compiled.push(result);
    }
  }
  const categoriesById = new Map<number, CategoryRow>(
    input.categories.map((category: CategoryRow): [number, CategoryRow] => [category.id, category]),
  );
  const byTransactionId = new Map<number, CategoryRow | null>();

  for (const t of input.transactions) {
    if (t.umsatztyp_id !== null) {
      byTransactionId.set(t.id, categoriesById.get(t.umsatztyp_id) ?? null);
      continue;
    }
    const account: AccountRow | undefined = input.accountsById.get(t.konto_id);
    if (!account) throw new Error(`account ${t.konto_id} of transaction ${t.id} is not loaded`);
    const candidate: Candidate = toCandidate(t, account);
    const hit: CompiledCategory | undefined = compiled.find((c: CompiledCategory) =>
      candidateMatches(c, candidate),
    );
    byTransactionId.set(t.id, hit?.category ?? null);
  }
  return { byTransactionId, invalidPatterns };
}
