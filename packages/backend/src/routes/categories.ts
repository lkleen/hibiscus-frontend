import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type {
  CategoryCycleError,
  CategoryRow,
} from '@hibiscus-frontend/shared/contracts/categories';
import { MissingReferenceError } from '../repositories/repository-errors';
import type { MissingReference } from '../repositories/repository-errors';
import type { CategoryRepository, CategoryUpdateResult } from '../repositories/umsatztyp';
import {
  CategoryCreateSchema,
  CategoryIdSchema,
  CategoryUpdateSchema,
} from '../categories/category-update';
import { respondWithValidationError } from './zod-validation';

const STATUS_BY_RESULT: Record<Exclude<CategoryUpdateResult, 'updated' | 'cycle'>, number> = {
  'not-found': 404,
  conflict: 409,
};

const UNKNOWN_BY_REFERENCE: Partial<Record<MissingReference, string>> = {
  'tax-section': 'Unknown tax section',
  account: 'Unknown account',
  parent: 'Unknown parent',
};

/** Answers 400 for a missing reference and reports whether it did. */
function respondWithMissingReference(error: unknown, res: Response): boolean {
  if (!(error instanceof MissingReferenceError)) return false;
  const message: string | undefined = UNKNOWN_BY_REFERENCE[error.reference];
  if (message === undefined) return false;
  res.status(400).json({ error: message });
  return true;
}

export interface CategoriesRouterDeps {
  readonly categories: CategoryRepository;
}

export function createCategoriesRouter(deps: CategoriesRouterDeps): Router {
  const router = Router();

  /** `GET /` lists `umsatztyp` rows exactly as stored (`CategoryRow`). */
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    deps.categories
      .list()
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

    deps.categories
      .create(bodyResult.data)
      .then((created: CategoryRow) => res.status(201).json(created))
      .catch((error: unknown) => {
        if (!respondWithMissingReference(error, res)) next(error);
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

    deps.categories
      .update(idResult.data, bodyResult.data)
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
        if (!respondWithMissingReference(error, res)) next(error);
      });
  });

  return router;
}
