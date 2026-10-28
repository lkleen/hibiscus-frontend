import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { TaxSection, TaxSectionError } from '@hibiscus-frontend/shared/contracts/tax-tags';
import {
  createTaxSection,
  deleteTaxSection,
  listTaxSections,
  updateTaxSection,
} from '../repositories/tax-section';
import type { TaxSectionUpdateResult } from '../repositories/tax-section';
import {
  TaxSectionCodeSchema,
  TaxSectionSchema,
  TaxSectionUpdateSchema,
} from '../tax/tax-section-schema';
import { respondWithValidationError } from './zod-validation';

const DUPLICATE_ENTRY_CODE = 'ER_DUP_ENTRY';
const ROW_IS_REFERENCED_CODE = 'ER_ROW_IS_REFERENCED_2';

/** Answers 409 with `error` when the DB error has `code`, and reports whether it did. */
function respondWithConflictOnCode(
  error: unknown,
  res: Response,
  mapping: { readonly code: string; readonly error: TaxSectionError['error'] },
): boolean {
  if ((error as { code?: unknown }).code !== mapping.code) return false;
  const body: TaxSectionError = { error: mapping.error };
  res.status(409).json(body);
  return true;
}

export function createTaxSectionsRouter(): Router {
  const router = Router();

  /** GET /: every user-maintained section ordered by code, without `St-0`. */
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listTaxSections()
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
    createTaxSection(bodyResult.data)
      .then((created: TaxSection) => res.status(201).json(created))
      .catch((error: unknown) => {
        const mapping = { code: DUPLICATE_ENTRY_CODE, error: 'duplicate' } as const;
        if (!respondWithConflictOnCode(error, res, mapping)) next(error);
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
    updateTaxSection(bodyResult.data.expected, bodyResult.data.next)
      .then((result: TaxSectionUpdateResult) => {
        if (result === 'updated') {
          res.status(204).send();
          return;
        }
        const conflict: TaxSectionError = { error: 'conflict' };
        res.status(409).json(conflict);
      })
      .catch((error: unknown) => {
        const mapping = { code: DUPLICATE_ENTRY_CODE, error: 'duplicate' } as const;
        if (!respondWithConflictOnCode(error, res, mapping)) next(error);
      });
  });

  /** DELETE /:code: 204, 400 invalid code, 404 no such section, 409 `in-use` (still a tag). */
  router.delete('/:code', (req: Request, res: Response, next: NextFunction): void => {
    const codeResult = TaxSectionCodeSchema.safeParse(req.params['code']);
    if (!codeResult.success) {
      respondWithValidationError(res, codeResult.error);
      return;
    }
    deleteTaxSection(codeResult.data)
      .then((deleted: boolean) => {
        if (deleted) {
          res.status(204).send();
          return;
        }
        res.status(404).json({ error: 'not-found' });
      })
      .catch((error: unknown) => {
        const mapping = { code: ROW_IS_REFERENCED_CODE, error: 'in-use' } as const;
        if (!respondWithConflictOnCode(error, res, mapping)) next(error);
      });
  });

  return router;
}
