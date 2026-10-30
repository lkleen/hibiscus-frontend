import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type {
  SyncConnectionStatus,
  SyncError,
  SyncStatusResponse,
} from '@hibiscus-frontend/shared/contracts/sync';
import type { UserKeyStatus } from '@hibiscus-frontend/shared/contracts/user';
import { currentUser } from '../db/pool';
import type {
  ChallengeImage,
  PendingTanRegistry,
  TanAnswerResult,
} from '../sync/pending-tan-registry';
import type { SyncService } from '../sync/sync-service';
import type { UserKeys } from '../sync/user-keys';
import { respondWithValidationError } from './zod-validation';

const RunIdSchema = z.coerce.number().int().positive();

/** A TAN is short; never trimmed away here, the registry trims it. */
const TanAnswerSchema = z.object({ tan: z.string().min(1).max(64).optional() }).strict();

export interface SyncRouterDeps {
  readonly service: Pick<SyncService, 'status'>;
  readonly registry: PendingTanRegistry;
  readonly keys: Pick<UserKeys, 'status'>;
}

/** `/api/sync`: the sync state and the answers to TAN challenges. */
export function createSyncRouter(deps: SyncRouterDeps): Router {
  const router = Router();

  /** GET /status: `SyncStatusResponse` — the user's key state and every connection's state. */
  router.get('/status', (_req: Request, res: Response, next: NextFunction): void => {
    Promise.all([deps.keys.status(currentUser().user), deps.service.status()])
      .then(([key, connections]: [UserKeyStatus, SyncConnectionStatus[]]) => {
        const body: SyncStatusResponse = { key, connections };
        res.json(body);
      })
      .catch(next);
  });

  /**
   * POST /runs/:id/tan: answer the run's open challenge. 204; 400 invalid body or a TAN missing for
   * a `tan`/`phototan` challenge; 409 `no-challenge`. For `decoupled` the TAN is ignored and the
   * bank is asked for the approval at once.
   */
  router.post('/runs/:id/tan', (req: Request, res: Response): void => {
    const idResult = RunIdSchema.safeParse(req.params['id']);
    if (!idResult.success) {
      respondWithValidationError(res, idResult.error);
      return;
    }
    const bodyResult = TanAnswerSchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      respondWithValidationError(res, bodyResult.error);
      return;
    }
    const result: TanAnswerResult = deps.registry.answer(idResult.data, bodyResult.data.tan);
    if (result === 'accepted') {
      res.status(204).send();
    } else if (result === 'tan-required') {
      res.status(400).json({ error: 'A TAN is required for this challenge' });
    } else {
      const body: SyncError = { error: 'no-challenge' };
      res.status(409).json(body);
    }
  });

  /** GET /runs/:id/challenge-image: the photoTAN image of the open challenge; 404 when none. */
  router.get('/runs/:id/challenge-image', (req: Request, res: Response): void => {
    const idResult = RunIdSchema.safeParse(req.params['id']);
    if (!idResult.success) {
      respondWithValidationError(res, idResult.error);
      return;
    }
    const image: ChallengeImage | null = deps.registry.image(idResult.data);
    if (image === null) {
      const body: SyncError = { error: 'not-found' };
      res.status(404).json(body);
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type(image.mimeType).send(image.bytes);
  });

  return router;
}
