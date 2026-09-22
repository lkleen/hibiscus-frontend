import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { listTransactions, updateTransactionCategory } from '../repositories/umsatz';
import { respondWithValidationError } from './zod-validation';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Pagination params are `limit`/`offset` rather than `page`/`pageSize`: they map 1:1 onto the
// repository's TransactionFilter and let the frontend request an arbitrary window without
// having to translate a page number back and forth.
const TransactionsQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  from: z.string().regex(DATE_PATTERN, 'from must be formatted as YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_PATTERN, 'to must be formatted as YYYY-MM-DD').optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

const UpdateTransactionCategorySchema = z.object({
  categoryId: z.number().int().positive().nullable(),
});

const TransactionIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export function createTransactionsRouter(): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = TransactionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      respondWithValidationError(res, parsed.error);
      return;
    }

    listTransactions(parsed.data)
      .then((result) => res.json(result))
      .catch(next);
  });

  router.patch('/:id', (req: Request, res: Response, next: NextFunction): void => {
    const paramsResult = TransactionIdParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      respondWithValidationError(res, paramsResult.error);
      return;
    }
    const bodyResult = UpdateTransactionCategorySchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }

    updateTransactionCategory(paramsResult.data.id, bodyResult.data.categoryId)
      .then(() => res.status(204).send())
      .catch(next);
  });

  return router;
}
