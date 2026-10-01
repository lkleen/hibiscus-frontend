import type { DatePreset, DatePresetUnit } from '@hibiscus-frontend/shared/contracts/user-settings';
import { DateRange, isInRange, resolvePreset, toIsoDate } from './date-range';

function relative(unit: DatePresetUnit, offset: number, count: number): DatePreset {
  return { id: 'x', name: null, kind: 'relative', unit, offset, count };
}

function resolve(preset: [DatePresetUnit, number, number], today: Date): DateRange {
  return resolvePreset(relative(...preset), today);
}

describe('toIsoDate', () => {
  it('uses the local calendar date, zero padded', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(toIsoDate(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});

describe('resolvePreset', () => {
  it('passes fixed presets through', () => {
    const preset: DatePreset = {
      id: 'x',
      name: null,
      kind: 'fixed',
      from: '2025-02-03',
      to: '2025-04-05',
    };
    expect(resolvePreset(preset, new Date(2026, 9, 1))).toEqual({
      from: '2025-02-03',
      to: '2025-04-05',
    });
  });

  describe('day', () => {
    it('offset 0 count 1 is today', () => {
      expect(resolve(['day', 0, 1], new Date(2026, 9, 1))).toEqual({
        from: '2026-10-01',
        to: '2026-10-01',
      });
    });
    it('offset -1 count 1 is yesterday across a month boundary', () => {
      expect(resolve(['day', -1, 1], new Date(2026, 9, 1))).toEqual({
        from: '2026-09-30',
        to: '2026-09-30',
      });
    });
    it('last 30 days includes today', () => {
      expect(resolve(['day', 0, 30], new Date(2026, 9, 1))).toEqual({
        from: '2026-09-02',
        to: '2026-10-01',
      });
    });
  });

  describe('week', () => {
    it('current week from a Wednesday', () => {
      expect(resolve(['week', 0, 1], new Date(2026, 9, 7))).toEqual({
        from: '2026-10-05',
        to: '2026-10-11',
      });
    });
    it('a Sunday belongs to the week that started the Monday before', () => {
      expect(resolve(['week', 0, 1], new Date(2026, 9, 11))).toEqual({
        from: '2026-10-05',
        to: '2026-10-11',
      });
    });
    it('a Monday starts a new week', () => {
      expect(resolve(['week', 0, 1], new Date(2026, 9, 5))).toEqual({
        from: '2026-10-05',
        to: '2026-10-11',
      });
    });
    it('previous week and multiple weeks', () => {
      expect(resolve(['week', -1, 1], new Date(2026, 9, 7))).toEqual({
        from: '2026-09-28',
        to: '2026-10-04',
      });
      expect(resolve(['week', -1, 2], new Date(2026, 9, 7))).toEqual({
        from: '2026-09-21',
        to: '2026-10-04',
      });
    });
  });

  describe('month', () => {
    it('current month', () => {
      expect(resolve(['month', 0, 1], new Date(2026, 9, 15))).toEqual({
        from: '2026-10-01',
        to: '2026-10-31',
      });
    });
    it('last month from a month end', () => {
      expect(resolve(['month', -1, 1], new Date(2026, 2, 31))).toEqual({
        from: '2026-02-01',
        to: '2026-02-28',
      });
    });
    it('last month across a year boundary', () => {
      expect(resolve(['month', -1, 1], new Date(2026, 0, 15))).toEqual({
        from: '2025-12-01',
        to: '2025-12-31',
      });
    });
    it('handles leap-year February', () => {
      expect(resolve(['month', -1, 1], new Date(2024, 2, 10))).toEqual({
        from: '2024-02-01',
        to: '2024-02-29',
      });
    });
    it('last three completed months', () => {
      expect(resolve(['month', -1, 3], new Date(2026, 9, 1))).toEqual({
        from: '2026-07-01',
        to: '2026-09-30',
      });
    });
  });

  describe('quarter', () => {
    it('current quarter at each quarter boundary', () => {
      expect(resolve(['quarter', 0, 1], new Date(2026, 0, 1))).toEqual({
        from: '2026-01-01',
        to: '2026-03-31',
      });
      expect(resolve(['quarter', 0, 1], new Date(2026, 3, 1))).toEqual({
        from: '2026-04-01',
        to: '2026-06-30',
      });
      expect(resolve(['quarter', 0, 1], new Date(2026, 5, 30))).toEqual({
        from: '2026-04-01',
        to: '2026-06-30',
      });
      expect(resolve(['quarter', 0, 1], new Date(2026, 9, 1))).toEqual({
        from: '2026-10-01',
        to: '2026-12-31',
      });
    });
    it('previous quarter across a year boundary', () => {
      expect(resolve(['quarter', -1, 1], new Date(2026, 1, 10))).toEqual({
        from: '2025-10-01',
        to: '2025-12-31',
      });
    });
    it('multiple quarters', () => {
      expect(resolve(['quarter', -1, 2], new Date(2026, 9, 1))).toEqual({
        from: '2026-04-01',
        to: '2026-09-30',
      });
    });
  });

  describe('year', () => {
    it('current year', () => {
      expect(resolve(['year', 0, 1], new Date(2026, 5, 15))).toEqual({
        from: '2026-01-01',
        to: '2026-12-31',
      });
    });
    it('last year and multiple years', () => {
      expect(resolve(['year', -1, 1], new Date(2026, 5, 15))).toEqual({
        from: '2025-01-01',
        to: '2025-12-31',
      });
      expect(resolve(['year', -1, 2], new Date(2026, 5, 15))).toEqual({
        from: '2024-01-01',
        to: '2025-12-31',
      });
    });
  });

  it('throws on an invalid count or offset', () => {
    expect(() => resolve(['day', 0, 0], new Date(2026, 9, 1))).toThrow();
    expect(() => resolve(['day', 0.5, 1], new Date(2026, 9, 1))).toThrow();
  });

  it('throws on an unknown unit', () => {
    const bad: DatePreset = relative('decade' as DatePresetUnit, 0, 1);
    expect(() => resolvePreset(bad, new Date(2026, 9, 1))).toThrow();
  });
});

describe('isInRange', () => {
  const closed: DateRange = { from: '2026-02-01', to: '2026-02-28' };

  it('includes both ends and excludes outside dates', () => {
    expect(isInRange('2026-02-01', closed)).toBe(true);
    expect(isInRange('2026-02-28', closed)).toBe(true);
    expect(isInRange('2026-01-31', closed)).toBe(false);
    expect(isInRange('2026-03-01', closed)).toBe(false);
  });

  it('treats null ends as open', () => {
    expect(isInRange('1999-01-01', { from: null, to: '2026-02-28' })).toBe(true);
    expect(isInRange('2026-03-01', { from: null, to: '2026-02-28' })).toBe(false);
    expect(isInRange('2999-01-01', { from: '2026-02-01', to: null })).toBe(true);
    expect(isInRange('2026-01-31', { from: '2026-02-01', to: null })).toBe(false);
    expect(isInRange('2026-02-15', { from: null, to: null })).toBe(true);
  });
});
