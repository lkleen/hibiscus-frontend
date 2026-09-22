import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { listAccounts } from '../repositories/konto';

/** `GET /api/accounts` — lists all `konto` rows. */
export function createAccountsRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listAccounts()
      .then((accounts) => res.json(accounts))
      .catch(next);
  });

  return router;
}
