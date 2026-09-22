import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Config } from '../config/config';

/**
 * Fixed header name for the pre-shared proxy secret. Unlike `AUTH_HEADER_USER`, this name is
 * intentionally NOT configurable — see docs/architecture.md#authentication. Only the secret's
 * *value* comes from config (`INTERNAL_PROXY_SECRET`).
 */
export const INTERNAL_AUTH_SECRET_HEADER = 'x-internal-auth-secret';

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Constant-time string comparison that never throws and never short-circuits on length, so a
 * mismatched-length secret takes the same time as a same-length one.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    // Compare the provided buffer against itself so a length mismatch takes roughly the same
    // time as a same-length, wrong-value comparison — no early return on length alone.
    timingSafeEqual(providedBuffer, providedBuffer);
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Unconditional forward-auth gate. Every request must carry both:
 *  - the identity header named by `config.AUTH_HEADER_USER`
 *  - the fixed `X-Internal-Auth-Secret` header, matching `config.INTERNAL_PROXY_SECRET` exactly
 *
 * Missing or mismatched either → 401, with no detail about which check failed. Only once both
 * pass is the identity header's value checked against `config.ALLOWED_USERS` → 403 if absent.
 * On success, `res.locals['user']` carries the identity for downstream handlers.
 *
 * There is no environment flag anywhere in this function that skips or weakens these checks.
 */
export function createAuthMiddleware(config: Config) {
  const identityHeaderName = config.AUTH_HEADER_USER.toLowerCase();

  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = headerValue(req.headers[identityHeaderName]);
    const secret = headerValue(req.headers[INTERNAL_AUTH_SECRET_HEADER]);

    if (identity === undefined || secret === undefined) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!secretsMatch(secret, config.INTERNAL_PROXY_SECRET)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!config.ALLOWED_USERS.includes(identity)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    res.locals['user'] = identity;
    next();
  };
}
