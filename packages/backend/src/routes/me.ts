import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Me } from '@hibiscus-frontend/shared/contracts/user';
import { currentUser } from '../db/pool';
import type { UserDatabases } from '../db/user-databases';
import type { AppUserKeyRecord, AppUserRepository } from '../repositories/app-user';

export interface MeRouterDeps {
  readonly databases: Pick<UserDatabases, 'databaseStatus'>;
  readonly appUsers: Pick<AppUserRepository, 'getKey'>;
  /** `DATA_SOURCE` of this server, reported as is. */
  readonly dataSource: Me['dataSource'];
}

/**
 * `GET /api/me` — the identity the auth middleware asserted, whether that user has set up their
 * Hibiscus database and their key yet, and the server's data source. Runs without the user's
 * database (see `middleware/user-db.ts`).
 */
export function createMeRouter(deps: MeRouterDeps): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    const user: string = currentUser().user;
    const run = async (): Promise<void> => {
      const database: Me['database'] = await deps.databases.databaseStatus(user);
      const key: AppUserKeyRecord | null = await deps.appUsers.getKey(user);
      const body: Me = {
        user,
        database,
        key: key === null ? 'unconfigured' : 'configured',
        dataSource: deps.dataSource,
      };
      res.json(body);
    };
    run().catch(next);
  });

  return router;
}
