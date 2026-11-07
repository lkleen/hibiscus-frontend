import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TaxTagRepository } from '../repositories/tax-tag';

/** Tags are written together with their category (`/api/categories`); this router only reads. */
export interface TaxTagsRouterDeps {
  readonly taxTags: TaxTagRepository;
}

export function createTaxTagsRouter(deps: TaxTagsRouterDeps): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    deps.taxTags
      .list()
      .then((tags: TaxTag[]) => res.json(tags))
      .catch(next);
  });

  return router;
}
