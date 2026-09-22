import type { Response } from 'express';
import type { ZodError } from 'zod';

/** Shared 400 response shape for a failed zod validation, used by every route module. */
export function respondWithValidationError(res: Response, error: ZodError): void {
  res.status(400).json({ error: 'Invalid request', details: error.flatten() });
}
