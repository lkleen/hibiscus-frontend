import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { account, transaction } from '../../features/transactions/testing/transaction-fixture';
import {
  assignCategories,
  compileCategory,
  matchesCategory,
  type CategoryAssignment,
  type CompiledCategory,
} from './category-matching';
import { categoryRow } from './testing/category-row-fixture';

function run(
  transactions: TransactionRow[],
  categories: CategoryRow[],
  accounts: AccountRow[] = [account({ id: 1, kategorie: 'Giro' })],
): CategoryAssignment {
  return assignCategories({
    transactions,
    categories,
    accountsById: new Map(accounts.map((a: AccountRow): [number, AccountRow] => [a.id, a])),
  });
}

function assignedId(result: CategoryAssignment, transactionId: number): number | null {
  const category: CategoryRow | null | undefined = result.byTransactionId.get(transactionId);
  if (category === undefined) throw new Error('transaction not in result');
  return category?.id ?? null;
}

describe('assignCategories', () => {
  it('lets a stored umsatztyp_id win over patterns', () => {
    const result: CategoryAssignment = run(
      [transaction({ zweck: 'rewe', umsatztyp_id: 2 })],
      [
        categoryRow({ id: 1, name: 'A', pattern: 'rewe' }),
        categoryRow({ id: 2, name: 'B', pattern: 'x' }),
      ],
    );
    expect(assignedId(result, 1)).toBe(2);
  });

  it('treats an unknown stored id as unassigned without matching', () => {
    const result: CategoryAssignment = run(
      [transaction({ zweck: 'rewe', umsatztyp_id: 99 })],
      [categoryRow({ id: 1, pattern: 'rewe' })],
    );
    expect(assignedId(result, 1)).toBeNull();
  });

  it('respects the category type against the sign, and accepts both for betrag 0', () => {
    const categories: CategoryRow[] = [
      categoryRow({ id: 1, name: 'income', pattern: 'x', umsatztyp: 1 }),
      categoryRow({ id: 2, name: 'expense', pattern: 'x', umsatztyp: 0 }),
      categoryRow({ id: 3, name: 'zany', pattern: 'x', umsatztyp: 2 }),
      categoryRow({ id: 4, name: 'znull', pattern: 'x', umsatztyp: null }),
    ];
    const result: CategoryAssignment = run(
      [
        transaction({ id: 1, zweck: 'x', betrag: 5 }),
        transaction({ id: 2, zweck: 'x', betrag: -5 }),
        transaction({ id: 3, zweck: 'x', betrag: 0 }),
      ],
      categories,
    );
    expect(assignedId(result, 1)).toBe(1);
    expect(assignedId(result, 2)).toBe(2);
    expect(assignedId(result, 3)).toBe(2);
    const anyOnly: CategoryAssignment = run(
      [transaction({ id: 1, zweck: 'x', betrag: 5 })],
      categories.slice(2),
    );
    expect(assignedId(anyOnly, 1)).toBe(3);
  });

  it('restricts by konto_id', () => {
    const result: CategoryAssignment = run(
      [transaction({ zweck: 'x', konto_id: 1 })],
      [
        categoryRow({ id: 1, name: 'A', pattern: 'x', konto_id: 2 }),
        categoryRow({ id: 2, name: 'B', pattern: 'x', konto_id: 1 }),
      ],
    );
    expect(assignedId(result, 1)).toBe(2);
  });

  it('restricts by konto_kategorie when non-empty', () => {
    const result: CategoryAssignment = run(
      [transaction({ zweck: 'x' })],
      [
        categoryRow({ id: 1, name: 'A', pattern: 'x', konto_kategorie: 'Other' }),
        categoryRow({ id: 2, name: 'B', pattern: 'x', konto_kategorie: '' }),
      ],
    );
    expect(assignedId(result, 1)).toBe(2);
    const match: CategoryAssignment = run(
      [transaction({ zweck: 'x' })],
      [categoryRow({ id: 1, pattern: 'x', konto_kategorie: 'Giro' })],
    );
    expect(assignedId(match, 1)).toBe(1);
  });

  it('throws when the transaction account is not loaded', () => {
    expect(() => run([transaction({ konto_id: 7 })], [categoryRow()], [])).toThrow();
  });

  it('splits terms on unescaped commas only', () => {
    const categories: CategoryRow[] = [categoryRow({ id: 1, pattern: 'foo, bar\\,baz' })];
    const result: CategoryAssignment = run(
      [
        transaction({ id: 1, zweck: 'a BAR b' }),
        transaction({ id: 2, zweck: 'bar,baz' }),
        transaction({ id: 3, zweck: 'baz' }),
      ],
      categories,
    );
    expect(assignedId(result, 1)).toBeNull();
    expect(assignedId(result, 2)).toBe(1);
    expect(assignedId(result, 3)).toBeNull();
  });

  it('never matches a blank pattern', () => {
    const result: CategoryAssignment = run(
      [transaction({ zweck: 'x' })],
      [categoryRow({ id: 1, pattern: '  ' }), categoryRow({ id: 2, pattern: null })],
    );
    expect(assignedId(result, 1)).toBeNull();
  });

  it('strips whitespace from zweck, name and name2 and from terms', () => {
    const result: CategoryAssignment = run(
      [
        transaction({ id: 1, zweck: 'Bahn', zweck2: ' Card\n', zweck3: 'x' }),
        transaction({ id: 2, empfaenger_name: 'Deutsche  Bahn' }),
      ],
      [categoryRow({ id: 1, pattern: 'bahn card, deutsche bahn' })],
    );
    expect(assignedId(result, 1)).toBe(1);
    expect(assignedId(result, 2)).toBe(1);
  });

  it('matches regex as a case-insensitive full match', () => {
    const categories: CategoryRow[] = [categoryRow({ id: 1, pattern: 'rew.', isregex: 1 })];
    const result: CategoryAssignment = run(
      [
        transaction({ id: 1, empfaenger_name: 'REWE' }),
        transaction({ id: 2, empfaenger_name: 'REWE Markt' }),
      ],
      categories,
    );
    expect(assignedId(result, 1)).toBe(1);
    expect(assignedId(result, 2)).toBeNull();
  });

  it('tests regex against the space-joined combination as well', () => {
    const result: CategoryAssignment = run(
      [transaction({ empfaenger_name: 'Foo', empfaenger_name2: 'Bar' })],
      [categoryRow({ id: 1, pattern: 'foo bar.*', isregex: 1 })],
    );
    expect(assignedId(result, 1)).toBe(1);
  });

  it('reports an invalid regex and never matches it', () => {
    const bad: CategoryRow = categoryRow({ id: 1, pattern: '(', isregex: 1 });
    const result: CategoryAssignment = run([transaction({ zweck: '(' })], [bad]);
    expect(result.invalidPatterns).toEqual([bad]);
    expect(assignedId(result, 1)).toBeNull();
  });

  it('orders candidates by nummer then name, case-insensitively, first match wins', () => {
    const result: CategoryAssignment = run(
      [transaction({ zweck: 'x' })],
      [
        categoryRow({ id: 1, name: 'b', nummer: null, pattern: 'x' }),
        categoryRow({ id: 2, name: 'A', nummer: null, pattern: 'x' }),
        categoryRow({ id: 3, name: 'Z', nummer: '1', pattern: 'x' }),
      ],
    );
    expect(assignedId(result, 1)).toBe(2);
  });

  it('matches the transaction id exactly in the non-regex path', () => {
    const result: CategoryAssignment = run(
      [transaction({ id: 42 }), transaction({ id: 4 })],
      [categoryRow({ id: 1, pattern: '42' })],
    );
    expect(assignedId(result, 42)).toBe(1);
    expect(assignedId(result, 4)).toBeNull();
  });
});

function compiled(category: CategoryRow): CompiledCategory {
  const result: ReturnType<typeof compileCategory> = compileCategory(category);
  if ('invalid' in result) throw new Error('category did not compile');
  return result;
}

describe('compileCategory', () => {
  it('flags a regex that does not compile', () => {
    const category: CategoryRow = categoryRow({ id: 1, pattern: '(', isregex: 1 });
    expect(compileCategory(category)).toEqual({ invalid: true, category });
  });

  it('compiles a valid regex and non-regex terms', () => {
    expect(compiled(categoryRow({ id: 1, pattern: 'a.*', isregex: 1 })).regex).not.toBeNull();
    expect(compiled(categoryRow({ id: 1, pattern: 'Foo, bar', isregex: 0 })).terms).toEqual([
      'foo',
      'bar',
    ]);
  });
});

describe('matchesCategory', () => {
  const giro: AccountRow = account({ id: 1, kategorie: 'Giro' });

  it('respects the category type', () => {
    const income: CompiledCategory = compiled(
      categoryRow({ id: 1, pattern: 'rewe', umsatztyp: 1 }),
    );
    expect(matchesCategory(income, transaction({ zweck: 'rewe', betrag: -5 }), giro)).toBe(false);
    expect(matchesCategory(income, transaction({ zweck: 'rewe', betrag: 5 }), giro)).toBe(true);
  });

  it('respects the account scope', () => {
    const scoped: CompiledCategory = compiled(categoryRow({ id: 1, pattern: 'rewe', konto_id: 2 }));
    expect(matchesCategory(scoped, transaction({ zweck: 'rewe', konto_id: 1 }), giro)).toBe(false);
    const byKind: CompiledCategory = compiled(
      categoryRow({ id: 1, pattern: 'rewe', konto_kategorie: 'Tagesgeld' }),
    );
    expect(matchesCategory(byKind, transaction({ zweck: 'rewe' }), giro)).toBe(false);
  });

  it('matches non-regex terms as substrings, case-insensitively', () => {
    const c: CompiledCategory = compiled(categoryRow({ id: 1, pattern: 'xyz, REWE' }));
    expect(matchesCategory(c, transaction({ zweck: 'Einkauf Rewe Markt' }), giro)).toBe(true);
    expect(matchesCategory(c, transaction({ zweck: 'Aldi' }), giro)).toBe(false);
  });

  it('matches a regex against the whole value', () => {
    const c: CompiledCategory = compiled(categoryRow({ id: 1, pattern: 'rewe', isregex: 1 }));
    expect(matchesCategory(c, transaction({ zweck: 'rewe' }), giro)).toBe(true);
    expect(matchesCategory(c, transaction({ zweck: 'rewe markt' }), giro)).toBe(false);
  });

  it('never matches an empty pattern', () => {
    const c: CompiledCategory = compiled(categoryRow({ id: 1, pattern: '  ' }));
    expect(matchesCategory(c, transaction({ zweck: 'anything' }), giro)).toBe(false);
  });
});
