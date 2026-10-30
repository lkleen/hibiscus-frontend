import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Me } from '@hibiscus-frontend/shared/contracts/user';
import { currentUser } from '../db/pool';
import { getAppUserKey } from '../repositories/app-user';
import type { AppUserKeyRecord } from '../repositories/app-user';
import type { UserPools } from '../db/user-pools';

/**
 * `GET /api/me` — the identity the auth middleware asserted, and whether that user has set up
 * their Hibiscus database and their key yet. Runs without the user's database (see `middleware/user-db.ts`).
 */
export function createMeRouter(pools: Pick<UserPools, 'databaseStatus'>): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    const user: string = currentUser().user;
    const run = async (): Promise<void> => {
      const database: Me['database'] = await pools.databaseStatus(user);
      const key: AppUserKeyRecord | null = await getAppUserKey(user);
      const body: Me = { user, database, key: key === null ? 'unconfigured' : 'configured' };
      res.json(body);
    };
    run().catch(next);
  });

  return router;
}
