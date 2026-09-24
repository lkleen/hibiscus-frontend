import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type {
  TransactionRow,
  UpdateTransactionCategory,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { z } from 'zod';
import { listTransactions, updateTransactionCategory } from '../repositories/umsatz';
import { respondWithValidationError } from './zod-validation';

const UpdateTransactionCategorySchema = z.object({
  categoryId: z.number().int().positive().nullable(),
});

const TransactionIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export function createTransactionsRouter(): Router {
  const router = Router();

  // Every row, unfiltered: sorting, filtering and paging are the grid's job (see the
  // `transactions-table` skill).
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listTransactions()
      .then((rows: TransactionRow[]) => res.json(rows))
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

    const body: UpdateTransactionCategory = bodyResult.data;
    updateTransactionCategory(paramsResult.data.id, body.categoryId)
      .then(() => res.status(204).send())
      .catch(next);
  });

  return router;
}
