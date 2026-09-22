import { Router } from 'express';
import type { Request, Response } from 'express';

/** `GET /api/me` — echoes the identity the auth middleware attached to `res.locals`. */
export function createMeRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response): void => {
    res.json({ user: res.locals['user'] as string });
  });

  return router;
}
