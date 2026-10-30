import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type {
  UserDatabaseResponse,
  UserDatabaseSettings,
  UserDatabaseTestResponse,
  UserDatabaseUpdateRequest,
  UserError,
} from '@hibiscus-frontend/shared/contracts/user';
import { formatAllowedDbHost, isDbHostAllowed } from '../config/config';
import type { AllowedDbHost } from '../config/config';
import { currentUser } from '../db/pool';
import type { DatabaseTarget } from '../db/pool';
import { UserBusyError, whileReconfiguring } from '../db/user-activity';
import type { UserPools } from '../db/user-pools';
import {
  getAppUserDatabase,
  isDatabaseUsedByOther,
  saveAppUserDatabase,
} from '../repositories/app-user';
import type { AppUserDatabaseRecord } from '../repositories/app-user';
import type { CredentialCrypto } from '../sync/credential-crypto';
import { respondWithValidationError } from './zod-validation';

export interface UserDatabaseRouterDeps {
  readonly pools: Pick<UserPools, 'invalidate'>;
  /** The server key instance; encrypts the database password. */
  readonly crypto: CredentialCrypto;
  readonly allowedHosts: readonly AllowedDbHost[];
  /** `testDatabaseConnection` from `db/pool.ts`; injected so specs need no database. */
  readonly test: (target: DatabaseTarget) => Promise<UserDatabaseTestResponse>;
}

const DUPLICATE_ENTRY_CODE = 'ER_DUP_ENTRY';

const UserDatabaseUpdateSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    name: z.string().min(1).max(64),
    user: z.string().min(1).max(80),
    password: z.string().min(1).max(512).optional(),
  })
  .strict();

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === DUPLICATE_ENTRY_CODE
  );
}

function sendUserError(res: Response, status: number, error: UserError['error']): void {
  const body: UserError = { error };
  res.status(status).json(body);
}

/** The target to connect to: the sent password, else the stored one; `null` when neither. */
async function resolveTarget(
  deps: UserDatabaseRouterDeps,
  username: string,
  request: UserDatabaseUpdateRequest,
): Promise<DatabaseTarget | null> {
  const settings: UserDatabaseSettings = {
    host: request.host,
    port: request.port,
    name: request.name,
    user: request.user,
  };
  if (request.password !== undefined) return { ...settings, password: request.password };
  const stored: AppUserDatabaseRecord | null = await getAppUserDatabase(username);
  if (stored === null) return null;
  return { ...settings, password: deps.crypto.decrypt(stored.password) };
}

/**
 * `/api/user/database` — the signed-in user's Hibiscus database connection. Runs without the
 * user's database (see `middleware/user-db.ts`). The password is write-only: it is never in a
 * response, and the test's error text has it masked.
 */
export function createUserDatabaseRouter(deps: UserDatabaseRouterDeps): Router {
  const router = Router();

  /** Validates the body and the allowlist, and finds the password; `null` once it answered. */
  async function prepare(req: Request, res: Response): Promise<DatabaseTarget | null> {
    const parsed = UserDatabaseUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      respondWithValidationError(res, parsed.error);
      return null;
    }
    if (!isDbHostAllowed(deps.allowedHosts, parsed.data)) {
      sendUserError(res, 400, 'host-not-allowed');
      return null;
    }
    const target: DatabaseTarget | null = await resolveTarget(
      deps,
      currentUser().user,
      parsed.data,
    );
    if (target === null) {
      // No `UserError` code fits a missing field; answered like every other validation error.
      respondWithValidationError(
        res,
        new z.ZodError([{ code: 'custom', path: ['password'], message: 'Required' }]),
      );
      return null;
    }
    return target;
  }

  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    getAppUserDatabase(currentUser().user)
      .then((record: AppUserDatabaseRecord | null): void => {
        const body: UserDatabaseResponse = {
          database: record === null ? null : { ...record.settings, passwordSet: true },
          allowedHosts: deps.allowedHosts.map(formatAllowedDbHost),
        };
        res.json(body);
      })
      .catch(next);
  });

  router.post('/test', (req: Request, res: Response, next: NextFunction): void => {
    const run = async (): Promise<void> => {
      const target: DatabaseTarget | null = await prepare(req, res);
      if (target === null) return;
      const result: UserDatabaseTestResponse = await deps.test(target);
      res.json(result);
    };
    run().catch(next);
  });

  /**
   * Tests, then saves, as the user's exclusive reconfiguration (see `db/user-activity.ts`):
   * `409 busy` while a sync runs, `409 database-in-use` when another user has the database, and no sync starts until the save is done. Saving raises
   * `db_version`; the old pool is ended.
   */
  router.put('/', (req: Request, res: Response, next: NextFunction): void => {
    const username: string = currentUser().user;
    const run = async (): Promise<void> => {
      const target: DatabaseTarget | null = await prepare(req, res);
      if (target === null) return;
      await whileReconfiguring(username, async (): Promise<void> => {
        const result: UserDatabaseTestResponse = await deps.test(target);
        if (!result.ok || !result.hibiscusSchema) {
          res.status(400).json(result);
          return;
        }
        const { password, ...settings } = target;
        if (await isDatabaseUsedByOther(username, settings)) {
          sendUserError(res, 409, 'database-in-use');
          return;
        }
        try {
          await saveAppUserDatabase({
            username,
            settings,
            password: deps.crypto.encrypt(password),
          });
        } catch (error: unknown) {
          // The unique key decides when two users save the same database at once.
          if (isDuplicateEntry(error)) {
            sendUserError(res, 409, 'database-in-use');
            return;
          }
          throw error;
        }
        deps.pools.invalidate(username);
        res.status(204).send();
      });
    };
    run().catch((error: unknown): void => {
      if (error instanceof UserBusyError) sendUserError(res, 409, 'busy');
      else next(error);
    });
  });

  return router;
}
