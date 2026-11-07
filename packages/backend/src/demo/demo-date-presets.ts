import type {
  DatePresetList,
  FixedDatePreset,
} from '@hibiscus-frontend/shared/contracts/user-settings';
import { DEFAULT_DATE_PRESETS } from '../settings/date-presets';

/** Months the demo's default range covers, ending on the dataset's last day. */
const DEMO_RANGE_MONTHS = 12;

/**
 * The demo user's date presets: first a fixed range over the last 12 months that hold data, then
 * the usual defaults. The first preset is the one every date range filter starts on, so a demo
 * download opens on data even when it is months older than today; the relative defaults would
 * resolve against today and could show an empty period.
 */
export function demoDatePresets(generatedAt: string): DatePresetList {
  const [year, month]: number[] = generatedAt.split('-').map(Number);
  const start: Date = new Date(Date.UTC(year, month - DEMO_RANGE_MONTHS, 1));
  const range: FixedDatePreset = {
    id: 'demo-data-last-12-months',
    // `null`: the frontend shows the range itself as the name, translated.
    name: null,
    kind: 'fixed',
    from: start.toISOString().slice(0, 10),
    to: generatedAt,
  };
  return [range, ...DEFAULT_DATE_PRESETS];
}
