import { z } from 'zod';
import type {
  TaxSection,
  TaxSectionCode,
  TaxSectionUpdateRequest,
  TaxTagCode,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { TAX_NOT_RELEVANT_CODE } from './tax-section-defaults';

/** `hf_tax_section.code` is `VARCHAR(16)`. */
const CODE_PATTERN = /^[A-Za-z0-9-]{1,16}$/;
/** `hf_tax_section.name` and `form` are `VARCHAR(200)`. */
const VARCHAR_200_MAX_LENGTH = 200;
/** The guidance columns are `TEXT` (65,535 bytes); at up to 4 bytes per character this many always fit. */
const TEXT_MAX_LENGTH = 16_383;

/** A tag code: any well-formed section code, or the built-in `St-0`. */
export const TaxTagCodeSchema: z.ZodType<TaxTagCode> = z.string().regex(CODE_PATTERN);

/** The code of a user-maintained section: well-formed and never the built-in `St-0`. */
export const TaxSectionCodeSchema: z.ZodType<TaxSectionCode> = z
  .string()
  .regex(CODE_PATTERN)
  .refine((code: string): boolean => code !== TAX_NOT_RELEVANT_CODE, {
    message: `${TAX_NOT_RELEVANT_CODE} is built in`,
  });

const GuidanceSchema: z.ZodType<string | null> = z.string().max(TEXT_MAX_LENGTH).nullable();

/** One section as `POST /api/tax-sections` takes it and `PUT` carries it. */
export const TaxSectionSchema: z.ZodType<TaxSection> = z
  .object({
    code: TaxSectionCodeSchema,
    name: z.string().trim().min(1).max(VARCHAR_200_MAX_LENGTH),
    form: z.string().max(VARCHAR_200_MAX_LENGTH).nullable(),
    belongs: GuidanceSchema,
    excludes: GuidanceSchema,
    receipts: GuidanceSchema,
    note: GuidanceSchema,
  })
  .strict();

/** Body of `PUT /api/tax-sections/:code`. */
export const TaxSectionUpdateSchema: z.ZodType<TaxSectionUpdateRequest> = z
  .object({ expected: TaxSectionSchema, next: TaxSectionSchema })
  .strict();
