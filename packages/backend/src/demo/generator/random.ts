/**
 * Seeded pseudo-random numbers (mulberry32), so the same seed always yields the same demo data.
 * Never use `Math.random()` in the generator.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new Error(`Random seed must be an integer, got ${seed}`);
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t: number = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Cannot pick from an empty list');
    const item: T | undefined = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('Random pick out of range');
    return item;
  }

  /**
   * Euro cents between `min` and `max` euros, skewed towards the low end (most purchases are
   * small, a few are large).
   */
  cents(min: number, max: number): number {
    const u: number = this.next();
    return Math.round((min + (max - min) * u * u) * 100);
  }

  /** How many times an event with an expected `rate` per day happens today. */
  count(rate: number): number {
    const whole: number = Math.floor(rate);
    return whole + (this.chance(rate - whole) ? 1 : 0);
  }
}

/** A stable 32-bit hash of `text` (FNV-1a), used to derive fake account numbers from names. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
