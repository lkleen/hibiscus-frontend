import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type {
  BankConnection,
  BankConnectionSettings,
  DiscoverDone,
  DiscoverResponse,
  SyncError,
  SyncStartResponse,
} from '@hibiscus-frontend/shared/contracts/sync';
import {
  createBankConnection,
  getBankConnection,
  listBankConnections,
  replaceBankConnectionAccounts,
  updateBankConnection,
} from '../repositories/bank-connection';
import type { BankConnectionWriteResult } from '../repositories/bank-connection';
import type { CredentialCrypto } from '../sync/credential-crypto';
import { ConflictError, NotFoundError } from '../sync/sync-service';
import type { StartedRun, SyncService } from '../sync/sync-service';
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

const CreateSchema = SettingsSchema.extend({ pin: PinSchema }).strict();

const UpdateSchema = z
  .object({ expected: SettingsSchema, next: SettingsSchema, pin: PinSchema.optional() })
  .strict();

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

/** Answers `ConflictError` with 409 `locked` and `NotFoundError` with 404; whether it did. */
function respondToServiceError(error: unknown, res: Response): boolean {
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

export interface BankConnectionsRouterDeps {
  readonly service: SyncService;
  readonly crypto: CredentialCrypto;
}

/** `/api/bank-connections`. The PIN is write-only: no response ever contains it. */
export function createBankConnectionsRouter(deps: BankConnectionsRouterDeps): Router {
  const router = Router();

  /** GET /: every connection ordered by name, with its account mapping. */
  router.get('/', (_req: Request, res: Response, next: NextFunction): void => {
    listBankConnections()
      .then((connections: BankConnection[]) => res.json(connections))
      .catch(next);
  });

  /** POST /: create a connection; 201 with it as stored, 400 invalid body. */
  router.post('/', (req: Request, res: Response, next: NextFunction): void => {
    const bodyResult = CreateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }
    const { pin, ...settings } = bodyResult.data;
    const typedSettings: BankConnectionSettings = settings;
    createBankConnection({ settings: typedSettings, pin: deps.crypto.encrypt(pin) })
      .then((id: number) => getBankConnection(id))
      .then((created: BankConnection | null) => {
        if (created === null) throw new Error('The created bank connection is gone');
        res.status(201).json(created);
      })
      .catch(next);
  });

  /** PUT /:id: change the settings (and the PIN when given). 204, 400, 404, 409 `conflict`. */
  router.put('/:id', (req: Request, res: Response, next: NextFunction): void => {
    const id: number | null = parseId(req, res);
    if (id === null) return;
    const bodyResult = UpdateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }
    const { expected, next: nextSettings, pin } = bodyResult.data;
    updateBankConnection({
      id,
      expected,
      next: nextSettings,
      ...(pin === undefined ? {} : { pin: deps.crypto.encrypt(pin) }),
    })
      .then((result: BankConnectionWriteResult) => {
        if (result === 'updated') {
          res.status(204).send();
          return;
        }
        sendError(res, result === 'conflict' ? 409 : 404, result);
      })
      .catch(next);
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

  /** POST /:id/discover: `DiscoverResponse`; 404, 409 `locked` while a run is in progress. */
  router.post('/:id/discover', (req: Request, res: Response, next: NextFunction): void => {
    const id: number | null = parseId(req, res);
    if (id === null) return;
    deps.service
      .discover(id)
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
   * POST /:id/sync: start a manual run (clears a pause). 202 `SyncStartResponse` once it holds the
   * lock; the run goes on in the background. 404, 409 `locked`.
   */
  router.post('/:id/sync', (req: Request, res: Response, next: NextFunction): void => {
    const id: number | null = parseId(req, res);
    if (id === null) return;
    deps.service
      .startSync(id, 'manual')
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
