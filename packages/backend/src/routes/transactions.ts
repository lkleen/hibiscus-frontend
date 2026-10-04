import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { TransactionsResponse } from '@hibiscus-frontend/shared/contracts/transactions';
import { listTransactions } from '../repositories/umsatz';

export function createTransactionsRouter(): Router {
  const router = Router();

  // Every row, unfiltered: sorting, filtering and paging are the grid's job (see the
  // `transactions-table` skill).
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listTransactions()
      .then((response: TransactionsResponse) => res.json(response))
      .catch(next);
  });

  return router;
}
