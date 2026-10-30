import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type {
  UserError,
  UserKeyCreateResponse,
  UserKeyStatus,
} from '@hibiscus-frontend/shared/contracts/user';
import { currentUser, runWithUserContext } from '../db/pool';
import type { UserDatabaseHandle } from '../db/pool';
import { UserBusyError } from '../db/user-activity';
import type { UserDatabaseLookup, UserPools } from '../db/user-pools';
import {
  KeyConfiguredError,
  KeyInvalidError,
  KeyModeError,
  KeyNotConfiguredError,
  KeyRequiredError,
} from '../sync/user-keys';
import type { UserKeys } from '../sync/user-keys';
import { respondWithValidationError } from './zod-validation';

/**
 * A key as sent; only its length is checked here, `decodeUserKey` checks the rest (`key-invalid`).
 * Never trimmed into or echoed by a validation error: zod names the field, never its value.
 */
export const KeyTextSchema = z.string().min(1).max(256);

/** The `WithUserKey` fields, for every body that may carry the key. */
export const WithUserKeySchema = z.object({
  key: KeyTextSchema.optional(),
  keepUnlocked: z.boolean().optional(),
});

const KeyModeSchema = z.enum(['manual', 'memory', 'stored']);

const CreateSchema = z.object({ key: KeyTextSchema.optional(), mode: KeyModeSchema }).strict();
const ModeSchema = z.object({ mode: KeyModeSchema, key: KeyTextSchema.optional() }).strict();
const UnlockSchema = z.object({ key: KeyTextSchema }).strict();
const ChangeSchema = z.object({ oldKey: KeyTextSchema, newKey: KeyTextSchema.optional() }).strict();

function sendUserError(res: Response, status: number, error: UserError['error']): void {
  const body: UserError = { error };
  res.status(status).json(body);
}

/**
 * Answers the key errors (and `UserBusyError`) with their `UserError` code; whether it did. Used
 * by every route that needs the user's key.
 */
export function respondToUserKeyError(error: unknown, res: Response): boolean {
  if (error instanceof KeyNotConfiguredError) sendUserError(res, 409, 'key-not-configured');
  else if (error instanceof KeyConfiguredError) sendUserError(res, 409, 'key-configured');
  else if (error instanceof KeyRequiredError) sendUserError(res, 400, 'key-required');
  else if (error instanceof KeyInvalidError) sendUserError(res, 400, 'key-invalid');
  else if (error instanceof UserBusyError) sendUserError(res, 409, 'busy');
  else if (error instanceof KeyModeError) {
    // No `UserError` code fits; answered like a validation error, as the request is wrong.
    res.status(400).json({ error: 'Invalid request', details: error.message });
  } else return false;
  return true;
}

export interface UserKeyRouterDeps {
  readonly keys: UserKeys;
  /** Change and reset work on the PINs in the user's database, which this router looks up. */
  readonly pools: Pick<UserPools, 'acquire'>;
}

/**
 * `/api/user/key` — the signed-in user's key for the bank PINs. Runs without the user's database
 * (see `middleware/user-db.ts`); change and reset look it up themselves. No response carries a key
 * except the one just created or changed to, and no error message ever contains one.
 */
export function createUserKeyRouter(deps: UserKeyRouterDeps): Router {
  const router = Router();

  /** Runs `work`, answering the key errors; anything else goes to the error handler. */
  function handle(res: Response, next: NextFunction, work: () => Promise<void>): void {
    work().catch((error: unknown): void => {
      if (!respondToUserKeyError(error, res)) next(error);
    });
  }

  /**
   * Runs `work` in the user's context with their database, or without one when none is set up
   * (then there are no PINs to touch); `null` once it answered `host-not-allowed`.
   */
  async function withUserDatabase<T>(res: Response, work: () => Promise<T>): Promise<T | null> {
    const user: string = currentUser().user;
    const lookup: UserDatabaseLookup = await deps.pools.acquire(user);
    if (lookup.status === 'host-not-allowed') {
      sendUserError(res, 400, 'host-not-allowed');
      return null;
    }
    const database: UserDatabaseHandle | null =
      lookup.status === 'configured' ? lookup.database : null;
    return runWithUserContext({ user, database }, work);
  }

  /** GET /: `UserKeyStatus`. */
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    handle(res, next, async (): Promise<void> => {
      const status: UserKeyStatus = await deps.keys.status(currentUser().user);
      res.json(status);
    });
  });

  /** POST /: set the first key; 201 `UserKeyCreateResponse`; 409 `key-configured`. */
  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      respondWithValidationError(res, parsed.error);
      return;
    }
    handle(res, next, async (): Promise<void> => {
      const key: string = await deps.keys.create(currentUser().user, parsed.data);
      const body: UserKeyCreateResponse = { key };
      res.status(201).json(body);
    });
  });

  /** PUT /mode: 204; `stored` needs the key (`key-required`, `key-invalid`). */
  router.put('/mode', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = ModeSchema.safeParse(req.body);
    if (!parsed.success) {
      respondWithValidationError(res, parsed.error);
      return;
    }
    handle(res, next, async (): Promise<void> => {
      await deps.keys.setMode(currentUser().user, parsed.data);
      res.status(204).send();
    });
  });

  /** POST /unlock: keep the key in server memory (`memory` mode); 204; 400 `key-invalid`. */
  router.post('/unlock', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = UnlockSchema.safeParse(req.body);
    if (!parsed.success) {
      respondWithValidationError(res, parsed.error);
      return;
    }
    handle(res, next, async (): Promise<void> => {
      await deps.keys.unlock(currentUser().user, parsed.data.key);
      res.status(204).send();
    });
  });

  /** POST /lock: forget the unlocked key; 204. */
  router.post('/lock', (_req: Request, res: Response, next: NextFunction): void => {
    handle(res, next, async (): Promise<void> => {
      await deps.keys.lock(currentUser().user);
      res.status(204).send();
    });
  });

  /**
   * POST /change: re-encrypt every PIN under the new key; 200 `UserKeyCreateResponse` with the new
   * key; 400 `key-invalid` for a wrong old key (nothing touched); 409 `busy` while a sync runs.
   */
  router.post('/change', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = ChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      respondWithValidationError(res, parsed.error);
      return;
    }
    handle(res, next, async (): Promise<void> => {
      const key: string | null = await withUserDatabase(res, () =>
        deps.keys.change(currentUser().user, parsed.data),
      );
      if (key === null) return;
      const body: UserKeyCreateResponse = { key };
      res.json(body);
    });
  });

  /** POST /reset: delete every stored PIN and the key; 204; 409 `busy` while a sync runs. */
  router.post('/reset', (_req: Request, res: Response, next: NextFunction): void => {
    handle(res, next, async (): Promise<void> => {
      const done: true | null = await withUserDatabase(res, async (): Promise<true> => {
        await deps.keys.reset(currentUser().user);
        return true;
      });
      if (done === null) return;
      res.status(204).send();
    });
  });

  return router;
}
