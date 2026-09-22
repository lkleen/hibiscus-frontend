import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/config';
import { createAuthMiddleware, INTERNAL_AUTH_SECRET_HEADER } from './auth';

const VALID_USER = 'alice@example.com';
const VALID_SECRET = 'super-secret-proxy-value';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    DB_HOST: 'localhost',
    DB_PORT: 3306,
    DB_NAME: 'hibiscus',
    DB_USER: 'hibiscus',
    DB_PASSWORD: 'password',
    PORT: 3000,
    AUTH_HEADER_USER: 'X-Forwarded-User',
    ALLOWED_USERS: [VALID_USER],
    INTERNAL_PROXY_SECRET: VALID_SECRET,
    ...overrides,
  };
}

interface MockContext {
  req: Request;
  res: Response;
  next: ReturnType<typeof vi.fn>;
  statusMock: ReturnType<typeof vi.fn>;
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

function makeContext(headers: Record<string, string>): MockContext {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  const req = { headers: lowercaseKeys(headers) } as unknown as Request;
  const res = { status: statusMock, locals: {} } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, statusMock };
}

describe('createAuthMiddleware', () => {
  const middleware = createAuthMiddleware(makeConfig());

  it('passes through when the identity header, matching secret, and allowlisted user are all present', () => {
    const { req, res, next } = makeContext({
      'X-Forwarded-User': VALID_USER,
      [INTERNAL_AUTH_SECRET_HEADER]: VALID_SECRET,
    });

    middleware(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.locals['user']).toBe(VALID_USER);
  });

  it('returns 401 when the identity header is missing', () => {
    const { req, res, next, statusMock } = makeContext({
      [INTERNAL_AUTH_SECRET_HEADER]: VALID_SECRET,
    });

    middleware(req, res, next as unknown as NextFunction);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret header is missing', () => {
    const { req, res, next, statusMock } = makeContext({
      'X-Forwarded-User': VALID_USER,
    });

    middleware(req, res, next as unknown as NextFunction);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret is present but wrong', () => {
    const { req, res, next, statusMock } = makeContext({
      'X-Forwarded-User': VALID_USER,
      [INTERNAL_AUTH_SECRET_HEADER]: 'wrong-secret',
    });

    middleware(req, res, next as unknown as NextFunction);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret has a different length than expected (no throw, no leak)', () => {
    const { req, res, next, statusMock } = makeContext({
      'X-Forwarded-User': VALID_USER,
      [INTERNAL_AUTH_SECRET_HEADER]: 'short',
    });

    expect(() => middleware(req, res, next as unknown as NextFunction)).not.toThrow();
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when header+secret are valid but the user is not allowlisted', () => {
    const { req, res, next, statusMock } = makeContext({
      'X-Forwarded-User': 'mallory@example.com',
      [INTERNAL_AUTH_SECRET_HEADER]: VALID_SECRET,
    });

    middleware(req, res, next as unknown as NextFunction);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('never yields a 2xx for any combination missing a valid header, a valid secret, or allowlisting', () => {
    const cases: Record<string, string>[] = [
      {},
      { 'X-Forwarded-User': VALID_USER },
      { [INTERNAL_AUTH_SECRET_HEADER]: VALID_SECRET },
      { 'X-Forwarded-User': '', [INTERNAL_AUTH_SECRET_HEADER]: VALID_SECRET },
      { 'X-Forwarded-User': VALID_USER, [INTERNAL_AUTH_SECRET_HEADER]: '' },
      { 'X-Forwarded-User': VALID_USER, [INTERNAL_AUTH_SECRET_HEADER]: 'wrong-secret' },
      { 'X-Forwarded-User': VALID_USER, [INTERNAL_AUTH_SECRET_HEADER]: 'short' },
      {
        'X-Forwarded-User': 'mallory@example.com',
        [INTERNAL_AUTH_SECRET_HEADER]: VALID_SECRET,
      },
    ];

    for (const headers of cases) {
      const { req, res, next, statusMock } = makeContext(headers);

      middleware(req, res, next as unknown as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledOnce();
      const statusCode = statusMock.mock.calls[0]?.[0] as number;
      expect(statusCode).toBeGreaterThanOrEqual(400);
      expect(statusCode).toBeLessThan(500);
    }
  });
});
