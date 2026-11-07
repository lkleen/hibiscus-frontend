import { describe, expect, it } from 'vitest';
import { createsCycle } from './category-tree';

const PARENTS: Map<number, number | null> = new Map<number, number | null>([
  [1, null],
  [2, 1],
  [3, 2],
  [4, null],
]);

describe('createsCycle', () => {
  it('is false for a root parent', () => {
    expect(createsCycle(3, null, PARENTS)).toBe(false);
  });

  it('is false for an unrelated parent', () => {
    expect(createsCycle(3, 4, PARENTS)).toBe(false);
  });

  it('is true when the parent is the row itself', () => {
    expect(createsCycle(2, 2, PARENTS)).toBe(true);
  });

  it('is true when the parent is a descendant', () => {
    expect(createsCycle(1, 3, PARENTS)).toBe(true);
  });

  it('throws on a loop that does not contain the row', () => {
    const looped: Map<number, number | null> = new Map<number, number | null>([
      [5, 6],
      [6, 5],
    ]);
    expect(() => createsCycle(1, 5, looped)).toThrow('parent loop');
  });
});
