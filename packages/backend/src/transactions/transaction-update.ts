import { z } from 'zod';
import type {
  TransactionAssignRequest,
  TransactionEditableFields,
  TransactionUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/transactions';

/** `umsatz.kommentar` is `TEXT` (65,535 bytes); at up to 4 bytes per UTF-8 character this many
 *  characters always fit, so a longer comment is a 400 rather than a DB error or truncation. */
const KOMMENTAR_MAX_LENGTH = 16_383;

const TransactionEditableFieldsSchema: z.ZodType<TransactionEditableFields> = z
  .object({
    kommentar: z.string().max(KOMMENTAR_MAX_LENGTH).nullable(),
    umsatztyp_id: z.number().int().positive().nullable(),
  })
  .strict();

/** Body of `PATCH /api/transactions/:id`: only the editable fields, before and after. */
export const TransactionUpdateSchema: z.ZodType<TransactionUpdateRequest> = z
  .object({
    expected: TransactionEditableFieldsSchema,
    next: TransactionEditableFieldsSchema,
  })
  .strict();

/** Upper bound of rows per bulk assignment; bigger requests are a 400, not a long transaction. */
const ASSIGN_MAX_ITEMS = 10_000;

/** Body of `POST /api/transactions/assign-category`: 1 to 10,000 unique rows and the category. */
export const TransactionAssignSchema: z.ZodType<TransactionAssignRequest> = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.number().int().positive(),
            expected: TransactionEditableFieldsSchema,
          })
          .strict(),
      )
      .min(1)
      .max(ASSIGN_MAX_ITEMS)
      .refine(
        (items: { id: number }[]): boolean => new Set(items.map((i) => i.id)).size === items.length,
        {
          message: 'Duplicate transaction ids',
        },
      ),
    umsatztyp_id: z.number().int().positive().nullable(),
  })
  .strict();

/** The `:id` route parameter: a positive integer, digits only. */
export const TransactionIdSchema: z.ZodType<number> = z.coerce.number().int().positive();
