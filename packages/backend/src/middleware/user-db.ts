import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserError } from '@hibiscus-frontend/shared/contracts/user';
import { runWithUserContext } from '../db/pool';
import type { UserDatabaseLookup, UserPools } from '../db/user-pools';

/** `/api/me` and `/api/user/*` work without a database: they are how a user sets one up. */
function runsWithoutDatabase(path: string): boolean {
  return path === '/me' || path.startsWith('/me/') || path === '/user' || path.startsWith('/user/');
}

/**
 * Runs after `auth` on the `/api` router. Resolves `res.locals.user` to their own database and
 * runs the rest of the request inside `runWithUserContext`, so `getPool()` in every repository
 * returns that user's pool. `next()` is called inside the context, so every handler after this
 * one — and everything they await — sees it.
 *
 * Data routes of a user without a database answer `409 database-not-configured`; a database
 * whose host left `ALLOWED_DB_HOSTS` answers `400 host-not-allowed`.
 */
export function createUserDbMiddleware(pools: Pick<UserPools, 'acquire'>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user: unknown = res.locals['user'];
    if (typeof user !== 'string') {
      throw new Error('The user-db middleware must run after the auth middleware');
    }
    if (runsWithoutDatabase(req.path)) {
      runWithUserContext({ user, database: null }, next);
      return;
    }
    pools
      .acquire(user)
      .then((lookup: UserDatabaseLookup): void => {
        if (lookup.status === 'unconfigured') {
          const body: UserError = { error: 'database-not-configured' };
          res.status(409).json(body);
          return;
        }
        if (lookup.status === 'host-not-allowed') {
          const body: UserError = { error: 'host-not-allowed' };
          res.status(400).json(body);
          return;
        }
        runWithUserContext({ user, database: lookup.database }, next);
      })
      .catch(next);
  };
}
