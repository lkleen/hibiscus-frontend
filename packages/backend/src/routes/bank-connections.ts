import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type {
  BankConnection,
  BankConnectionSettings,
  DiscoverDone,
  DiscoverResponse,
  SyncError,
  SyncStartRequest,
  SyncStartResponse,
  WithUserKey,
} from '@hibiscus-frontend/shared/contracts/sync';
import { currentUser } from '../db/pool';
import { whileUserBusy } from '../db/user-activity';
import {
  createBankConnection,
  getBankConnection,
  listBankConnections,
  replaceBankConnectionAccounts,
  updateBankConnection,
} from '../repositories/bank-connection';
import type { BankConnectionWriteResult } from '../repositories/bank-connection';
import type { EncryptedSecret } from '../sync/credential-crypto';
import { ConflictError, NotFoundError } from '../sync/sync-service';
import type { StartedRun, SyncService } from '../sync/sync-service';
import { encryptPin } from '../sync/user-keys';
import type { UserKeys } from '../sync/user-keys';
import { respondToUserKeyError, WithUserKeySchema } from './user-key';
import { respondWithValidationError } from './zod-validation';

const NO_REFERENCED_ROW_CODE = 'ER_NO_REFERENCED_ROW_2';

const IdSchema = z.coerce.number().int().positive();

const SettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    blz: z.string().regex(/^\d{8}$/, 'BLZ must be 8 digits'),
    fintsUrl: z
      .string()
      .trim()
      .max(255)
      .url()
      .refine((url: string): boolean => url.startsWith('https://'), 'fintsUrl must be https'),
    loginName: z.string().trim().min(1).max(100),
    customerId: z.string().trim().min(1).max(100).nullable(),
    tanMethod: z.number().int().nonnegative().nullable(),
    tanMedia: z.string().trim().min(1).max(100).nullable(),
    syncIntervalHours: z.number().int().min(1).max(168),
    enabled: z.boolean(),
  })
  .strict();

/** Never trimmed or echoed; a validation error names the field, never its value. */
const PinSchema = z.string().min(1).max(64);

const CreateSchema = SettingsSchema.extend({ pin: PinSchema }).merge(WithUserKeySchema).strict();

const UpdateSchema = z
  .object({ expected: SettingsSchema, next: SettingsSchema, pin: PinSchema.optional() })
  .merge(WithUserKeySchema)
  .strict();

const SyncStartSchema = WithUserKeySchema.strict();

const AccountsSchema = z
  .object({
    accounts: z
      .array(
        z
          .object({
            accountIdentifier: z.string().trim().min(1).max(64),
            kontoId: z.number().int().positive(),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (accounts: { accountIdentifier: string }[]): boolean =>
          new Set(
            accounts.map((account: { accountIdentifier: string }) => account.accountIdentifier),
          ).size === accounts.length,
        'accountIdentifier must be unique',
      ),
  })
  .strict();

function sendError(res: Response, status: number, error: SyncError['error']): void {
  const body: SyncError = { error };
  res.status(status).json(body);
}

/**
 * Answers `ConflictError` with 409 `locked`, `NotFoundError` with 404 and the key errors with
 * their `UserError` code; whether it did.
 */
function respondToServiceError(error: unknown, res: Response): boolean {
  if (respondToUserKeyError(error, res)) return true;
  if (error instanceof ConflictError) {
    sendError(res, 409, 'locked');
    return true;
  }
  if (error instanceof NotFoundError) {
    sendError(res, 404, 'not-found');
    return true;
  }
  return false;
}

/** Parses `:id`, answering 400 when invalid. */
function parseId(req: Request, res: Response): number | null {
  const result = IdSchema.safeParse(req.params['id']);
  if (!result.success) {
    respondWithValidationError(res, result.error);
    return null;
  }
  return result.data;
}

/** Parses the `SyncStartRequest` body (none = `{}`), answering 400 when invalid. */
function parseSyncStart(req: Request, res: Response): SyncStartRequest | null {
  const result = SyncStartSchema.safeParse(req.body ?? {});
  if (!result.success) {
    respondWithValidationError(res, result.error);
    return null;
  }
  return result.data;
}

export interface BankConnectionsRouterDeps {
  readonly service: Pick<
    SyncService,
    'deleteConnection' | 'discover' | 'describeDiscovery' | 'startSync'
  >;
  readonly keys: Pick<UserKeys, 'resolve'>;
}

/**
 * `/api/bank-connections`. The PIN is write-only: no response ever contains it. It is encrypted
 * with the user's key (see `WithUserKey`), so creating a connection or replacing its PIN needs
 * the key, and so do a sync and a discovery.
 */
export function createBankConnectionsRouter(deps: BankConnectionsRouterDeps): Router {
  const router = Router();

  /**
   * Encrypts the PIN with the user's key and writes it, as one run of the user: a key change
   * cannot re-encrypt the PINs meanwhile (`409 busy` while it does).
   */
  function writeWithPin<T>(
    input: WithUserKey & { readonly pin: string },
    write: (pin: EncryptedSecret) => Promise<T>,
  ): Promise<T> {
    const user: string = currentUser().user;
    return whileUserBusy(user, async (): Promise<T> => {
      const key: Buffer = await deps.keys.resolve(user, input);
      let encrypted: EncryptedSecret;
      try {
        encrypted = encryptPin(key, input.pin);
      } finally {
        key.fill(0);
      }
      return write(encrypted);
    });
  }

  /** GET /: every connection ordered by name, with its account mapping. */
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listBankConnections()
      .then((connections: BankConnection[]) => res.json(connections))
      .catch(next);
  });

  /**
   * POST /: create a connection; 201 with it as stored, 400 invalid body, the key errors
   * (`key-required`, `key-invalid`, 409 `key-not-configured`), 409 `busy`.
   */
  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    const bodyResult = CreateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }
    const { pin, key, keepUnlocked, ...settings } = bodyResult.data;
    const typedSettings: BankConnectionSettings = settings;
    writeWithPin({ pin, key, keepUnlocked }, (encrypted: EncryptedSecret) =>
      createBankConnection({ settings: typedSettings, pin: encrypted }),
    )
      .then((id: number) => getBankConnection(id))
      .then((created: BankConnection | null) => {
        if (created === null) throw new Error('The created bank connection is gone');
        res.status(201).json(created);
      })
      .catch((error: unknown) => {
        if (!respondToUserKeyError(error, res)) next(error);
      });
  });

  /**
   * PUT /:id: change the settings (and the PIN when given, which needs the key). 204, 400, 404,
   * 409 `conflict`, and with a PIN the key errors and 409 `busy`.
   */
  router.put('/:id', (req: Request, res: Response, next: NextFunction): void => {
    const id: number | null = parseId(req, res);
    if (id === null) return;
    const bodyResult = UpdateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }
    const { expected, next: nextSettings, pin, key, keepUnlocked } = bodyResult.data;
    const update: Promise<BankConnectionWriteResult> =
      pin === undefined
        ? updateBankConnection({ id, expected, next: nextSettings })
        : writeWithPin({ pin, key, keepUnlocked }, (encrypted: EncryptedSecret) =>
            updateBankConnection({ id, expected, next: nextSettings, pin: encrypted }),
          );
    update
      .then((result: BankConnectionWriteResult) => {
        if (result === 'updated') {
          res.status(204).send();
          return;
        }
        sendError(res, result === 'conflict' ? 409 : 404, result);
      })
      .catch((error: unknown) => {
        if (!respondToUserKeyError(error, res)) next(error);
      });
  });

  /**
   * DELETE /:id: 204, 404 when missing, 409 `locked` while a run or discovery is in progress.
   * Removes the account mapping and runs too.
   */
  router.delete('/:id', (req: Request, res: Response, next: NextFunction): void => {
    const id: number | null = parseId(req, res);
    if (id === null) return;
    deps.service
      .deleteConnection(id)
      .then((deleted: boolean) => {
        if (deleted) {
          res.status(204).send();
          return;
        }
        sendError(res, 404, 'not-found');
      })
      .catch((error: unknown) => {
        if (!respondToServiceError(error, res)) next(error);
      });
  });

  /**
   * POST /:id/discover, body `SyncStartRequest`: `DiscoverResponse`; 404, 409 `locked` while a run
   * is in progress, the key errors, 409 `busy`.
   */
  router.post('/:id/discover', (req: Request, res: Response, next: NextFunction): void => {
    const id: number | null = parseId(req, res);
    if (id === null) return;
    const input: SyncStartRequest | null = parseSyncStart(req, res);
    if (input === null) return;
    const user: string = currentUser().user;
    deps.service
      .discover({ connectionId: id, key: () => deps.keys.resolve(user, input) })
      .then((response: DiscoverResponse) => res.json(response))
      .catch((error: unknown) => {
        if (!respondToServiceError(error, res)) next(error);
      });
  });

  /** GET /:id/discovery: the last discovery's result from stored data; 404 when there is none. */
  router.get('/:id/discovery', (req: Request, res: Response, next: NextFunction): void => {
    const id: number | null = parseId(req, res);
    if (id === null) return;
    deps.service
      .describeDiscovery(id)
      .then((done: DiscoverDone | null) => {
        if (done === null) {
          sendError(res, 404, 'not-found');
          return;
        }
        res.json(done);
      })
      .catch((error: unknown) => {
        if (!respondToServiceError(error, res)) next(error);
      });
  });

  /** PUT /:id/accounts: replace the account mapping. 204, 400 (also unknown kontoId), 404. */
  router.put('/:id/accounts', (req: Request, res: Response, next: NextFunction): void => {
    const id: number | null = parseId(req, res);
    if (id === null) return;
    const bodyResult = AccountsSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }
    replaceBankConnectionAccounts(id, bodyResult.data.accounts)
      .then((result: 'updated' | 'not-found') => {
        if (result === 'updated') {
          res.status(204).send();
          return;
        }
        sendError(res, 404, 'not-found');
      })
      .catch((error: unknown) => {
        if ((error as { code?: unknown }).code === NO_REFERENCED_ROW_CODE) {
          res.status(400).json({ error: 'Unknown kontoId' });
          return;
        }
        next(error);
      });
  });

  /**
   * POST /:id/sync, body `SyncStartRequest`: start a manual run (clears a pause). 202
   * `SyncStartResponse` once it holds the lock; the run goes on in the background. 404, 409
   * `locked`, the key errors (checked before any run starts), 409 `busy`.
   */
  router.post('/:id/sync', (req: Request, res: Response, next: NextFunction): void => {
    const id: number | null = parseId(req, res);
    if (id === null) return;
    const input: SyncStartRequest | null = parseSyncStart(req, res);
    if (input === null) return;
    const user: string = currentUser().user;
    deps.service
      .startSync({
        connectionId: id,
        trigger: 'manual',
        key: () => deps.keys.resolve(user, input),
      })
      .then((started: StartedRun) => {
        // The top level of a manual run: it has recorded its failure, only log it here.
        started.done.catch((error: unknown) => {
          console.error(`[hibiscus-backend] Sync run ${started.runId} failed:`, error);
        });
        const body: SyncStartResponse = { runId: started.runId };
        res.status(202).json(body);
      })
      .catch((error: unknown) => {
        if (!respondToServiceError(error, res)) next(error);
      });
  });

  return router;
}
