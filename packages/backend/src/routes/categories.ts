import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../repositories/umsatztyp';
import { respondWithValidationError } from './zod-validation';

const CreateCategorySchema = z.object({
  name: z.string().min(1),
  parentId: z.number().int().positive().nullable(),
  color: z.string().min(1).nullable(),
});

const UpdateCategorySchema = z
  .object({
    name: z.string().min(1).optional(),
    parentId: z.number().int().positive().nullable().optional(),
    color: z.string().min(1).nullable().optional(),
  })
  .refine(
    (data): boolean => Object.keys(data).length > 0,
    'at least one of name, parentId, color must be provided',
  );

const CategoryIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** `GET/POST /api/categories`, `PATCH/DELETE /api/categories/:id` — `umsatztyp` CRUD. */
export function createCategoriesRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listCategories()
      .then((categories) => res.json(categories))
      .catch(next);
  });

  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = CreateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      respondWithValidationError(res, parsed.error);
      return;
    }

    createCategory(parsed.data)
      .then((category) => res.status(201).json(category))
      .catch(next);
  });

  router.patch('/:id', (req: Request, res: Response, next: NextFunction): void => {
    const paramsResult = CategoryIdParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      respondWithValidationError(res, paramsResult.error);
      return;
    }
    const bodyResult = UpdateCategorySchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }

    updateCategory(paramsResult.data.id, bodyResult.data)
      .then(() => res.status(204).send())
      .catch(next);
  });

  router.delete('/:id', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = CategoryIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      respondWithValidationError(res, parsed.error);
      return;
    }

    deleteCategory(parsed.data.id)
      .then(() => res.status(204).send())
      .catch(next);
  });

  return router;
}
