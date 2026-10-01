import { z } from 'zod';
import type {
  DatePresetLimits,
  DatePresetList,
} from '@hibiscus-frontend/shared/contracts/user-settings';

export const DATE_PRESETS_SETTING_KEY = 'date-presets';

/** Typed against the shared `DatePresetLimits` contract, which the frontend's form also uses. */
export const DATE_PRESET_LIMITS: DatePresetLimits = {
  maxPresets: 50,
  maxIdLength: 64,
  maxNameLength: 80,
  minCount: 1,
  maxCount: 366,
  maxAgo: 100,
};

/**
 * The four built-in relative presets: current month, last month, current year, last year.
 * All have `name: null`, so the frontend generates translated names from their definitions.
 */
export const DEFAULT_DATE_PRESETS: DatePresetList = [
  {
    id: 'current-month',
    kind: 'relative',
    unit: 'month',
    offset: 0,
    count: 1,
    name: null,
  },
  {
    id: 'last-month',
    kind: 'relative',
    unit: 'month',
    offset: -1,
    count: 1,
    name: null,
  },
  {
    id: 'current-year',
    kind: 'relative',
    unit: 'year',
    offset: 0,
    count: 1,
    name: null,
  },
  {
    id: 'last-year',
    kind: 'relative',
    unit: 'year',
    offset: -1,
    count: 1,
    name: null,
  },
];

/** `YYYY-MM-DD` that names a real calendar day — `new Date('2026-02-30')` would silently roll over
 *  into March, so the parsed parts are compared back instead. */
const IsoDateSchema: z.ZodType<string> = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value: string): boolean => {
    const [year, month, day]: number[] = value.split('-').map(Number);
    const date: Date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Not a calendar date');

const PresetIdSchema: z.ZodType<string> = z.string().min(1).max(DATE_PRESET_LIMITS.maxIdLength);
const PresetNameSchema: z.ZodType<string | null> = z
  .string()
  .trim()
  .min(1)
  .max(DATE_PRESET_LIMITS.maxNameLength)
  .nullable();

/**
 * Validation schema for the complete date preset list. Typed as `z.ZodType<DatePresetList>`
 * so it cannot drift from the shared contract.
 */
export const DatePresetListSchema: z.ZodType<DatePresetList> = z
  .array(
    // `z.union`, not `z.discriminatedUnion`: zod 3's discriminated union rejects the refined
    // (`ZodEffects`) fixed-preset member below.
    z.union([
      z.object({
        kind: z.literal('relative'),
        id: PresetIdSchema,
        name: PresetNameSchema,
        unit: z.enum(['day', 'week', 'month', 'quarter', 'year']),
        offset: z.number().int().min(-DATE_PRESET_LIMITS.maxAgo).max(0),
        count: z.number().int().min(DATE_PRESET_LIMITS.minCount).max(DATE_PRESET_LIMITS.maxCount),
      }),
      z
        .object({
          kind: z.literal('fixed'),
          id: PresetIdSchema,
          name: PresetNameSchema,
          from: IsoDateSchema,
          to: IsoDateSchema,
        })
        // ISO dates compare correctly as strings.
        .refine((preset: { from: string; to: string }): boolean => preset.from <= preset.to, {
          message: '`from` must not be after `to`',
          path: ['to'],
        }),
    ]),
  )
  .max(DATE_PRESET_LIMITS.maxPresets)
  .refine(
    (presets: DatePresetList): boolean =>
      new Set(presets.map((preset: DatePresetList[number]) => preset.id)).size === presets.length,
    { message: 'Preset ids must be unique' },
  );
