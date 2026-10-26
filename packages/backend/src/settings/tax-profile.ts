import { z } from 'zod';
import type { TaxProfile, TaxSituation } from '@hibiscus-frontend/shared/contracts/user-settings';

export const TAX_PROFILE_SETTING_KEY = 'tax-profile';

/** Every `TaxSituation`; the compile-time check below fails if the contract gains an id. */
export const TAX_SITUATIONS = [
  'employed',
  'children',
  'household',
  'rental',
  'donations',
] as const satisfies readonly TaxSituation[];

type MissingTaxSituation = Exclude<TaxSituation, (typeof TAX_SITUATIONS)[number]>;
// Compiles only while MissingTaxSituation is `never`.
export const TAX_SITUATIONS_COMPLETE: [MissingTaxSituation] extends [never] ? true : never = true;

/** Nothing answered yet and no hint dismissed. */
export const DEFAULT_TAX_PROFILE: TaxProfile = {
  situations: {
    employed: null,
    children: null,
    household: null,
    rental: null,
    donations: null,
  },
  hintDismissedYear: null,
};

/** Strict objects: unknown keys are rejected; every situation is required (`boolean | null`). */
export const TaxProfileSchema: z.ZodType<TaxProfile> = z
  .object({
    situations: z
      .object(
        Object.fromEntries(
          TAX_SITUATIONS.map((id: TaxSituation) => [id, z.boolean().nullable()]),
        ) as Record<TaxSituation, z.ZodNullable<z.ZodBoolean>>,
      )
      .strict(),
    hintDismissedYear: z.number().int().min(1900).max(9999).nullable(),
  })
  .strict();
