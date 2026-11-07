import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { TaxSection, TaxSectionError } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { DuplicateKeyError, StillReferencedError } from '../repositories/repository-errors';
import type { TaxSectionRepository, TaxSectionUpdateResult } from '../repositories/tax-section';
import {
  TaxSectionCodeSchema,
  TaxSectionSchema,
  TaxSectionUpdateSchema,
} from '../tax/tax-section-schema';
import { respondWithValidationError } from './zod-validation';

/** Answers 409 `duplicate` / `in-use` for the matching domain error and reports whether it did. */
function respondWithConflictError(error: unknown, res: Response): boolean {
  let body: TaxSectionError;
  if (error instanceof DuplicateKeyError) body = { error: 'duplicate' };
  else if (error instanceof StillReferencedError) body = { error: 'in-use' };
  else return false;
  res.status(409).json(body);
  return true;
}

export interface TaxSectionsRouterDeps {
  readonly taxSections: TaxSectionRepository;
}

export function createTaxSectionsRouter(deps: TaxSectionsRouterDeps): Router {
  const router = Router();

  /** GET /: every user-maintained section ordered by code, without `St-0`. */
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    deps.taxSections
      .list()
      .then((sections: TaxSection[]) => res.json(sections))
      .catch(next);
  });

  /** POST /: create a section. 201 with it as stored, 400 invalid body, 409 `duplicate`. */
  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    const bodyResult = TaxSectionSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }
    deps.taxSections
      .create(bodyResult.data)
      .then((created: TaxSection) => res.status(201).json(created))
      .catch((error: unknown) => {
        if (!respondWithConflictError(error, res)) next(error);
      });
  });

  /**
   * PUT /:code: change one section, possibly its code. 204 on success, 400 invalid body or `:code`
   * not `expected.code`, 409 `conflict` (it no longer holds `expected`) or `duplicate` (the new
   * code is taken).
   */
  router.put('/:code', (req: Request, res: Response, next: NextFunction): void => {
    const codeResult = TaxSectionCodeSchema.safeParse(req.params['code']);
    if (!codeResult.success) {
      respondWithValidationError(res, codeResult.error);
      return;
    }
    const bodyResult = TaxSectionUpdateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }
    if (bodyResult.data.expected.code !== codeResult.data) {
      res.status(400).json({ error: 'Code does not match expected.code' });
      return;
    }
    deps.taxSections
      .update(bodyResult.data.expected, bodyResult.data.next)
      .then((result: TaxSectionUpdateResult) => {
        if (result === 'updated') {
          res.status(204).send();
          return;
        }
        const conflict: TaxSectionError = { error: 'conflict' };
        res.status(409).json(conflict);
      })
      .catch((error: unknown) => {
        if (!respondWithConflictError(error, res)) next(error);
      });
  });

  /** DELETE /:code: 204, 400 invalid code, 404 no such section, 409 `in-use` (still a tag). */
  router.delete('/:code', (req: Request, res: Response, next: NextFunction): void => {
    const codeResult = TaxSectionCodeSchema.safeParse(req.params['code']);
    if (!codeResult.success) {
      respondWithValidationError(res, codeResult.error);
      return;
    }
    deps.taxSections
      .delete(codeResult.data)
      .then((deleted: boolean) => {
        if (deleted) {
          res.status(204).send();
          return;
        }
        res.status(404).json({ error: 'not-found' });
      })
      .catch((error: unknown) => {
        if (!respondWithConflictError(error, res)) next(error);
      });
  });

  return router;
}
