import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { listCategories } from '../repositories/umsatztyp';

/** `GET /api/categories` — lists `umsatztyp` rows exactly as stored (`CategoryRow`). */
export function createCategoriesRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listCategories()
      .then((categories) => res.json(categories))
      .catch(next);
  });

  return router;
}
