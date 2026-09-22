import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { listPayees } from '../repositories/empfaenger';
import { respondWithValidationError } from './zod-validation';

const PayeesQuerySchema = z.object({
  q: z.string().min(1).optional(),
});

/** `GET /api/payees` — lists `empfaenger` rows, optionally filtered by `?q=` free text. */
export function createPayeesRouter(): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = PayeesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      respondWithValidationError(res, parsed.error);
      return;
    }

    listPayees(parsed.data.q)
      .then((payees) => res.json(payees))
      .catch(next);
  });

  return router;
}
