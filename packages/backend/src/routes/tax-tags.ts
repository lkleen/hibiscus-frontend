import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { listTaxTags } from '../repositories/tax-tag';

/** Tags are written together with their category (`/api/categories`); this router only reads. */
export function createTaxTagsRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listTaxTags()
      .then((tags: TaxTag[]) => res.json(tags))
      .catch(next);
  });

  return router;
}
