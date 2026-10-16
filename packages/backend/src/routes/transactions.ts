import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { TransactionsResponse } from '@hibiscus-frontend/shared/contracts/transactions';
import { listTransactions, updateTransaction } from '../repositories/umsatz';
import type { TransactionUpdateResult } from '../repositories/umsatz';
import { TransactionIdSchema, TransactionUpdateSchema } from '../transactions/transaction-update';
import { respondWithValidationError } from './zod-validation';

/** MySQL error code for a foreign key violation on insert/update (unknown `umsatztyp_id`). */
const FK_VIOLATION_CODE = 'ER_NO_REFERENCED_ROW_2';

const STATUS_BY_RESULT: Record<Exclude<TransactionUpdateResult, 'updated'>, number> = {
  'not-found': 404,
  conflict: 409,
};

export function createTransactionsRouter(): Router {
  const router = Router();

  // Every row, unfiltered: sorting, filtering and paging are the grid's job (see the
  // `transactions-table` skill).
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listTransactions()
      .then((response: TransactionsResponse) => res.json(response))
      .catch(next);
  });

  /**
   * PATCH /:id: change the comment and category of one transaction. 204 on success, 400 invalid
   * id/body or unknown category, 404 no such transaction, 409 it no longer holds `expected`.
   */
  router.patch('/:id', (req: Request, res: Response, next: NextFunction): void => {
    const idResult = TransactionIdSchema.safeParse(req.params['id']);
    if (!idResult.success) {
      respondWithValidationError(res, idResult.error);
      return;
    }
    const bodyResult = TransactionUpdateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }

    updateTransaction(idResult.data, bodyResult.data)
      .then((result: TransactionUpdateResult) => {
        if (result === 'updated') {
          res.status(204).send();
          return;
        }
        res.status(STATUS_BY_RESULT[result]).json({ error: result });
      })
      .catch((error: unknown) => {
        if ((error as { code?: unknown }).code === FK_VIOLATION_CODE) {
          res.status(400).json({ error: 'Unknown category' });
          return;
        }
        next(error);
      });
  });

  return router;
}
