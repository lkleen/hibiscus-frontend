import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type {
  CategoryCycleError,
  CategoryRow,
} from '@hibiscus-frontend/shared/contracts/categories';
import { createCategory, listCategories, updateCategory } from '../repositories/umsatztyp';
import type { CategoryUpdateResult } from '../repositories/umsatztyp';
import {
  CategoryCreateSchema,
  CategoryIdSchema,
  CategoryUpdateSchema,
} from '../categories/category-update';
import { respondWithValidationError } from './zod-validation';

/** MySQL error code for a foreign key violation on insert/update (unknown parent or account). */
const FK_VIOLATION_CODE = 'ER_NO_REFERENCED_ROW_2';

const STATUS_BY_RESULT: Record<Exclude<CategoryUpdateResult, 'updated' | 'cycle'>, number> = {
  'not-found': 404,
  conflict: 409,
};

/**
 * Answers 400 for a foreign key violation and reports whether it did. The server message names
 * the violated constraint (`fk_umsatztyp_konto`, `fk_umsatztyp_umsatztyp` or
 * `fk_hf_tax_tag_section`).
 */
function respondWithForeignKeyError(error: unknown, res: Response): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== FK_VIOLATION_CODE) return false;
  const constraint = String(message);
  const unknown: string = constraint.includes('fk_hf_tax_tag_section')
    ? 'Unknown tax section'
    : constraint.includes('fk_umsatztyp_konto')
      ? 'Unknown account'
      : 'Unknown parent';
  res.status(400).json({ error: unknown });
  return true;
}

export function createCategoriesRouter(): Router {
  const router = Router();

  /** `GET /` lists `umsatztyp` rows exactly as stored (`CategoryRow`). */
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listCategories()
      .then((categories: CategoryRow[]) => res.json(categories))
      .catch(next);
  });

  /**
   * POST /: create a category. 201 with the created `CategoryRow` as stored, 400 invalid body or
   * unknown parent/account/tax section.
   */
  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    const bodyResult = CategoryCreateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }

    createCategory(bodyResult.data)
      .then((created: CategoryRow) => res.status(201).json(created))
      .catch((error: unknown) => {
        if (!respondWithForeignKeyError(error, res)) next(error);
      });
  });

  /**
   * PUT /:id: change one category. 204 on success, 400 invalid id/body, unknown parent/account/tax section or
   * `CategoryCycleError` (the new parent is the row or a descendant), 404 no such category, 409 it
   * no longer holds `expected` (row or tax tag).
   */
  router.put('/:id', (req: Request, res: Response, next: NextFunction): void => {
    const idResult = CategoryIdSchema.safeParse(req.params['id']);
    if (!idResult.success) {
      respondWithValidationError(res, idResult.error);
      return;
    }
    const bodyResult = CategoryUpdateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }

    updateCategory(idResult.data, bodyResult.data)
      .then((result: CategoryUpdateResult) => {
        if (result === 'updated') {
          res.status(204).send();
          return;
        }
        if (result === 'cycle') {
          const cycle: CategoryCycleError = { error: 'cycle' };
          res.status(400).json(cycle);
          return;
        }
        res.status(STATUS_BY_RESULT[result]).json({ error: result });
      })
      .catch((error: unknown) => {
        if (!respondWithForeignKeyError(error, res)) next(error);
      });
  });

  return router;
}
