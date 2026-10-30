import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { currentUser, getPool } from '../db/pool';
import type { UserDatabaseHandle } from '../db/pool';
import type { UserDatabaseLookup, UserPools } from '../db/user-pools';
import { createUserDbMiddleware } from './user-db';

interface HttpResponse {
  status: number;
  body: unknown;
}

let acquire: Mock<UserPools['acquire']>;
let server: ReturnType<Express['listen']>;
let baseUrl: string;

function databaseOf(user: string): UserDatabaseHandle {
  return {
    pool: { owner: user } as unknown as Pool,
    settings: { host: 'hibiscus-db', port: 3306, name: user, user },
  };
}

async function get(path: string, user: string): Promise<HttpResponse> {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-test-user': user },
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(
  () =>
    new Promise<void>((resolve: () => void) => {
      const app: Express = express();
      const api: express.Router = express.Router();
      // Stands in for `auth`, which sets `res.locals.user`.
      api.use((req: Request, res: Response, next: NextFunction): void => {
        res.locals['user'] = req.headers['x-test-user'];
        next();
      });
      api.use(createUserDbMiddleware({ acquire: (user: string) => acquire(user) }));
      api.get('/me', (_req: Request, res: Response): void => {
        res.json({ user: currentUser().user, database: currentUser().database });
      });
      api.get('/user/database', (_req: Request, res: Response): void => {
        res.json({ user: currentUser().user });
      });
      // An async handler: the context must survive its awaits.
      api.get('/accounts', (_req: Request, res: Response, next: NextFunction): void => {
        const run = async (): Promise<void> => {
          await new Promise<void>((done: () => void) => setTimeout(done, 10));
          await Promise.resolve();
          res.json({
            user: currentUser().user,
            pool: (getPool() as unknown as { owner: string }).owner,
          });
        };
        run().catch(next);
      });
      app.use('/api', api);
      // eslint-disable-next-line @typescript-eslint/max-params, @typescript-eslint/no-unused-vars
      app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
        res.status(500).json({ error: 'Internal Server Error' });
      });
      server = app.listen(0, () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          throw new Error('Test server has no port');
        }
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve: () => void) => {
      server.close(() => resolve());
    }),
);

beforeEach(() => {
  vi.resetAllMocks();
  acquire = vi.fn(async (user: string): Promise<UserDatabaseLookup> => ({
    status: 'configured',
    database: databaseOf(user),
  }));
});

describe('user-db middleware', () => {
  it('runs data routes on the user’s own pool, across async handlers', async () => {
    const [alice, bob] = await Promise.all([
      get('/api/accounts', 'alice'),
      get('/api/accounts', 'bob'),
    ]);

    expect(alice).toEqual({ status: 200, body: { user: 'alice', pool: 'alice' } });
    expect(bob).toEqual({ status: 200, body: { user: 'bob', pool: 'bob' } });
  });

  it('answers 409 database-not-configured on data routes of a user without a database', async () => {
    acquire.mockResolvedValue({ status: 'unconfigured' });

    expect(await get('/api/accounts', 'alice')).toEqual({
      status: 409,
      body: { error: 'database-not-configured' },
    });
  });

  it('answers 400 host-not-allowed when the stored host left the allowlist', async () => {
    acquire.mockResolvedValue({ status: 'host-not-allowed' });

    expect(await get('/api/accounts', 'alice')).toEqual({
      status: 400,
      body: { error: 'host-not-allowed' },
    });
  });

  it('runs /api/me and /api/user/* without a database, in the user’s context', async () => {
    acquire.mockResolvedValue({ status: 'unconfigured' });

    expect(await get('/api/me', 'alice')).toEqual({
      status: 200,
      body: { user: 'alice', database: null },
    });
    expect(await get('/api/user/database', 'alice')).toEqual({
      status: 200,
      body: { user: 'alice' },
    });
    expect(acquire).not.toHaveBeenCalled();
  });

  it('hands a failing database lookup to the error handler', async () => {
    acquire.mockRejectedValue(new Error('connect ECONNREFUSED'));

    expect((await get('/api/accounts', 'alice')).status).toBe(500);
  });
});
