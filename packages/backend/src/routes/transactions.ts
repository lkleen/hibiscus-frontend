import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type {
  TransactionAssignConflict,
  TransactionsResponse,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { assignCategory, listTransactions, updateTransaction } from '../repositories/umsatz';
import type { TransactionAssignResult, TransactionUpdateResult } from '../repositories/umsatz';
import {
  TransactionAssignSchema,
  TransactionIdSchema,
  TransactionUpdateSchema,
} from '../transactions/transaction-update';
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
   * POST /assign-category: set the category of many transactions, all or nothing. 204 on success,
   * 400 invalid body or unknown category, 409 `TransactionAssignConflict` when any row no longer
   * holds its `expected` values. Registered before `/:id` so the literal path is never an id.
   */
  router.post('/assign-category', (req: Request, res: Response, next: NextFunction): void => {
    const bodyResult = TransactionAssignSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }

    assignCategory(bodyResult.data)
      .then((result: TransactionAssignResult) => {
        if (result.result === 'assigned') {
          res.status(204).send();
          return;
        }
        const conflict: TransactionAssignConflict = {
          error: 'conflict',
          conflictIds: result.conflictIds,
        };
        res.status(409).json(conflict);
      })
      .catch((error: unknown) => {
        if ((error as { code?: unknown }).code === FK_VIOLATION_CODE) {
          res.status(400).json({ error: 'Unknown category' });
          return;
        }
        next(error);
      });
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
