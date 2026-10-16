import { z } from 'zod';
import type {
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

/** The `:id` route parameter: a positive integer, digits only. */
export const TransactionIdSchema: z.ZodType<number> = z.coerce.number().int().positive();
