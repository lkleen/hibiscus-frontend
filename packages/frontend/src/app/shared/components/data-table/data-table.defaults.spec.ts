import { DEFAULT_TABLE_OPTIONS, containsMatcher, defaultComparator } from './data-table.defaults';

/**
 * Mirrors what `DataTableComponent.compareRows` does with a column `comparator`: call it for the
 * *ascending* result, then multiply by the sort order to get the final compare delta for the
 * requested direction. `defaultComparator` (and any custom comparator) is tested through this
 * helper rather than directly, because the ascending-result contract only makes sense once this
 * final step is applied — that's the whole point of the contract (see `data-table.model.ts`'s
 * `comparator` doc comment). `[a, b]` is a pair, not two parameters, to stay within `max-params`.
 */
function finalCompare<Value>(
  comparator: (a: Value, b: Value, isDescending: boolean) => number,
  [a, b]: readonly [Value, Value],
  order: 1 | -1,
): number {
  return comparator(a, b, order === -1) * order;
}

describe('defaultComparator', () => {
  it('sorts non-empty values ascending', () => {
    expect(finalCompare(defaultComparator, [1, 2], 1)).toBeLessThan(0);
    expect(finalCompare(defaultComparator, [2, 1], 1)).toBeGreaterThan(0);
    expect(finalCompare(defaultComparator, [1, 1], 1)).toBe(0);
  });

  it('sorts non-empty values descending as the exact reverse of ascending', () => {
    expect(finalCompare(defaultComparator, [1, 2], -1)).toBeGreaterThan(0);
    expect(finalCompare(defaultComparator, [2, 1], -1)).toBeLessThan(0);
    // `.toBeCloseTo`, not `.toBe`: `0 * -1` is `-0`, which `Object.is`-based `.toBe(0)` rejects
    // even though `-0 === 0` — a JS quirk, not a sign the compare result differs from equal.
    expect(finalCompare(defaultComparator, [1, 1], -1)).toBeCloseTo(0);
  });

  it('sorts empty values (null/undefined/"") after every non-empty value, ascending', () => {
    expect(finalCompare<string | null>(defaultComparator, [null, 'x'], 1)).toBeGreaterThan(0);
    expect(finalCompare<string | null>(defaultComparator, ['x', null], 1)).toBeLessThan(0);
    expect(finalCompare<string | null | undefined>(defaultComparator, [null, undefined], 1)).toBe(
      0,
    );
  });

  it('keeps empty values last in descending order too, not first', () => {
    expect(finalCompare<string | null>(defaultComparator, [null, 'x'], -1)).toBeGreaterThan(0);
    expect(finalCompare<string | null>(defaultComparator, ['x', null], -1)).toBeLessThan(0);
    // See the `-0` note above.
    expect(
      finalCompare<string | null | undefined>(defaultComparator, [null, undefined], -1),
    ).toBeCloseTo(0);
  });

  it('compares strings numeric-aware, not lexicographically ("a2" before "a10")', () => {
    expect(finalCompare(defaultComparator, ['a2', 'a10'], 1)).toBeLessThan(0);
    expect(finalCompare(defaultComparator, ['a10', 'a2'], 1)).toBeGreaterThan(0);
    // Plain lexicographic comparison would put 'a10' before 'a2' ('1' < '2'); numeric-aware
    // comparison treats the digit runs as numbers instead.
  });

  it('sorts a realistic list correctly in both directions, empties pinned last both ways', () => {
    const values: readonly (string | null)[] = ['b', null, 'a', 'c', null];

    const ascending = [...values].sort((a, b) => finalCompare(defaultComparator, [a, b], 1));
    expect(ascending).toEqual(['a', 'b', 'c', null, null]);

    const descending = [...values].sort((a, b) => finalCompare(defaultComparator, [a, b], -1));
    expect(descending).toEqual(['c', 'b', 'a', null, null]);
  });

  it('lets a custom comparator ignore isDescending entirely and just return the ascending result', () => {
    // A "custom comparator" in the sense `DataTableColDef.comparator` documents: an ordinary
    // ascending-only compare function, with no third parameter at all.
    const ascendingOnlyComparator = (a: number, b: number): number => a - b;
    const values = [3, 1, 2];

    const ascending = [...values].sort((a, b) => finalCompare(ascendingOnlyComparator, [a, b], 1));
    expect(ascending).toEqual([1, 2, 3]);

    const descending = [...values].sort((a, b) =>
      finalCompare(ascendingOnlyComparator, [a, b], -1),
    );
    expect(descending).toEqual([3, 2, 1]);
  });
});

describe('containsMatcher', () => {
  it('matches case-insensitively', () => {
    expect(containsMatcher('Supermarket', 'market')).toBe(true);
    expect(containsMatcher('Supermarket', 'MARKET')).toBe(true);
  });

  it('matches accent-insensitively, like PrimeNG\'s own "contains" match mode', () => {
    expect(containsMatcher('Café', 'cafe')).toBe(true);
    expect(containsMatcher('Müller', 'muller')).toBe(true);
  });

  it('treats a blank query as matching everything', () => {
    expect(containsMatcher('anything', '')).toBe(true);
    expect(containsMatcher('anything', '   ')).toBe(true);
  });

  it('does not match an absent substring', () => {
    expect(containsMatcher('Supermarket', 'xyz')).toBe(false);
  });
});

describe('DEFAULT_TABLE_OPTIONS', () => {
  it('has autoSizeStrategy: { type: "fitGridWidth" }', () => {
    expect(DEFAULT_TABLE_OPTIONS.autoSizeStrategy).toEqual({ type: 'fitGridWidth' });
  });

  it('has columnResize: { mode: "expand" }', () => {
    expect(DEFAULT_TABLE_OPTIONS.columnResize).toEqual({ mode: 'expand' });
  });
});
