import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { AccountRepository } from '../repositories/konto';

export interface AccountsRouterDeps {
  readonly accounts: AccountRepository;
}

/** `GET /api/accounts` — lists all `konto` rows. */
export function createAccountsRouter(deps: AccountsRouterDeps): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    deps.accounts
      .list()
      .then((accounts) => res.json(accounts))
      .catch(next);
  });

  return router;
}
