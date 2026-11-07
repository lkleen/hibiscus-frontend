import { describe, expect, it } from 'vitest';
import { hashText, Random } from './random';

describe('Random', () => {
  it('repeats the same sequence for the same seed', () => {
    const first: Random = new Random(42);
    const second: Random = new Random(42);

    for (let i = 0; i < 100; i++) expect(first.next()).toBe(second.next());
  });

  it('keeps int() within its inclusive bounds', () => {
    const rng: Random = new Random(1);
    const seen: Set<number> = new Set<number>();

    for (let i = 0; i < 1000; i++) seen.add(rng.int(3, 5));

    expect([...seen].sort()).toEqual([3, 4, 5]);
  });

  it('throws for a non-integer seed and an empty pick', () => {
    expect(() => new Random(1.5)).toThrow();
    expect(() => new Random(1).pick([])).toThrow();
  });

  it('hashes text stably', () => {
    expect(hashText('Tobias Testmann')).toBe(hashText('Tobias Testmann'));
    expect(hashText('Tobias Testmann')).not.toBe(hashText('Sabine Testmann'));
  });
});
