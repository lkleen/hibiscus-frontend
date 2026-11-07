import { describe, expect, it } from 'vitest';
import type { DatePresetList } from '@hibiscus-frontend/shared/contracts/user-settings';
import { DEFAULT_DATE_PRESETS, DatePresetListSchema } from '../settings/date-presets';
import { demoDatePresets } from './demo-date-presets';

describe('demoDatePresets', () => {
  it('starts with a fixed range over the 12 months up to the last day with data', () => {
    const presets: DatePresetList = demoDatePresets('2026-11-07');

    expect(presets[0]).toEqual({
      id: 'demo-data-last-12-months',
      name: null,
      kind: 'fixed',
      from: '2025-12-01',
      to: '2026-11-07',
    });
  });

  it('crosses the year boundary correctly', () => {
    const presets: DatePresetList = demoDatePresets('2027-01-31');

    expect(presets[0]).toMatchObject({ from: '2026-02-01', to: '2027-01-31' });
  });

  it('keeps the usual defaults after the demo range and passes the settings schema', () => {
    const presets: DatePresetList = demoDatePresets('2026-11-07');

    expect(presets.slice(1)).toEqual(DEFAULT_DATE_PRESETS);
    expect(DatePresetListSchema.safeParse(presets).success).toBe(true);
  });
});
