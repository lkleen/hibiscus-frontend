import { z } from 'zod';
import type {
  CategoryCreateRequest,
  CategoryEditableFields,
  CategoryUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/categories';

/** `umsatztyp.name`, `konto_kategorie` are `VARCHAR(255)`. */
const VARCHAR_255_MAX_LENGTH = 255;
/** `umsatztyp.nummer` is `VARCHAR(5)`. */
const NUMMER_MAX_LENGTH = 5;
/** `umsatztyp.color` is `VARCHAR(11)`: "255,255,255" is the longest valid value. */
const COLOR_MAX_LENGTH = 11;
/** `umsatztyp.pattern` is `TEXT` (65,535 bytes) in `utf8mb3`: at up to 3 bytes per character this
 *  many characters always fit. */
const PATTERN_MAX_LENGTH = 21_845;
/** `umsatztyp.kommentar` is `TEXT` (65,535 bytes); at up to 4 bytes per UTF-8 character this many
 *  characters always fit, so a longer comment is a 400 rather than a DB error or truncation. */
const KOMMENTAR_MAX_LENGTH = 16_383;
const COLOR_CHANNEL_MAX = 255;

const COLOR_PATTERN = /^(\d{1,3}),(\d{1,3}),(\d{1,3})$/;

const FlagSchema: z.ZodType<number | null> = z.union([z.literal(0), z.literal(1)]).nullable();

const ColorSchema: z.ZodType<string | null> = z
  .string()
  .max(COLOR_MAX_LENGTH)
  .refine(
    (value: string): boolean => {
      const match: RegExpMatchArray | null = COLOR_PATTERN.exec(value);
      return match !== null && match.slice(1).every((c: string) => Number(c) <= COLOR_CHANNEL_MAX);
    },
    { message: 'Color must be "r,g,b" with each channel 0 to 255' },
  )
  .nullable();

const OptionalIdSchema: z.ZodType<number | null> = z.number().int().positive().nullable();

/** The writable `umsatztyp` columns (everything but `id`), each bounded by its column type. */
export const CategoryEditableFieldsSchema: z.ZodType<CategoryEditableFields> = z
  .object({
    name: z.string().trim().min(1).max(VARCHAR_255_MAX_LENGTH),
    nummer: z.string().max(NUMMER_MAX_LENGTH).nullable(),
    pattern: z.string().max(PATTERN_MAX_LENGTH).nullable(),
    isregex: FlagSchema,
    umsatztyp: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
    parent_id: OptionalIdSchema,
    color: ColorSchema,
    customcolor: FlagSchema,
    kommentar: z.string().max(KOMMENTAR_MAX_LENGTH).nullable(),
    konto_id: OptionalIdSchema,
    konto_kategorie: z.string().max(VARCHAR_255_MAX_LENGTH).nullable(),
    flags: z.number().int().nonnegative().nullable(),
  })
  .strict();

/** Body of `POST /api/categories`. */
export const CategoryCreateSchema: z.ZodType<CategoryCreateRequest> = CategoryEditableFieldsSchema;

/** Body of `PUT /api/categories/:id`: the editable fields, before and after. */
export const CategoryUpdateSchema: z.ZodType<CategoryUpdateRequest> = z
  .object({
    expected: CategoryEditableFieldsSchema,
    next: CategoryEditableFieldsSchema,
  })
  .strict();

/** The `:id` route parameter: a positive integer, digits only. */
export const CategoryIdSchema: z.ZodType<number> = z.coerce.number().int().positive();
