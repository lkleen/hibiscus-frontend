import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type {
  TaxTag,
  TaxTagChange,
  TaxTagsConflict,
  TaxTagsUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { applyTaxTagChanges, listTaxTags } from '../repositories/tax-tag';
import type { TaxTagApplyResult } from '../repositories/tax-tag';
import { TAX_TAG_CODES } from '../tax/tax-tag-codes';
import { respondWithValidationError } from './zod-validation';

const MAX_CHANGES = 500;

const TaxTagCodeSchema = z.enum(TAX_TAG_CODES);

/** Body of `PUT /api/tax-tags`: 1 to 500 changes, one per category, each actually changing the tag. */
const TaxTagsUpdateSchema: z.ZodType<TaxTagsUpdateRequest> = z
  .object({
    changes: z
      .array(
        z
          .object({
            category_id: z.number().int().positive(),
            expected: TaxTagCodeSchema.nullable(),
            next: TaxTagCodeSchema.nullable(),
          })
          .strict()
          .refine((change: TaxTagChange): boolean => change.expected !== change.next, {
            message: 'expected and next must differ',
          }),
      )
      .min(1)
      .max(MAX_CHANGES)
      .refine(
        (changes: TaxTagChange[]): boolean =>
          new Set(changes.map((c: TaxTagChange): number => c.category_id)).size === changes.length,
        { message: 'Duplicate category ids' },
      ),
  })
  .strict();

export function createTaxTagsRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listTaxTags()
      .then((tags: TaxTag[]) => res.json(tags))
      .catch(next);
  });

  /**
   * PUT /: apply tag changes, all or nothing. 204 on success, 400 invalid body, 409
   * `TaxTagsConflict` when a category's tag changed or the category no longer exists.
   */
  router.put('/', (req: Request, res: Response, next: NextFunction): void => {
    const bodyResult = TaxTagsUpdateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }

    applyTaxTagChanges(bodyResult.data)
      .then((result: TaxTagApplyResult) => {
        if (result.result === 'saved') {
          res.status(204).send();
          return;
        }
        const conflict: TaxTagsConflict = { error: 'conflict', conflictIds: result.conflictIds };
        res.status(409).json(conflict);
      })
      .catch(next);
  });

  return router;
}
