import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Me } from '@hibiscus-frontend/shared/contracts/user';
vi.mock('../repositories/app-user', () => ({ getAppUserKey: vi.fn() }));

import { runWithUserContext } from '../db/pool';
import type { UserPools } from '../db/user-pools';
import { getAppUserKey } from '../repositories/app-user';
import { createMeRouter } from './me';

const databaseStatus: Mock<UserPools['databaseStatus']> = vi.fn();
let server: ReturnType<Express['listen']>;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve: () => void) => {
      const app: Express = express();
      app.use((req: Request, _res: Response, next: NextFunction): void => {
        runWithUserContext({ user: String(req.headers['x-test-user']), database: null }, next);
      });
      app.use('/me', createMeRouter({ databaseStatus }));
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

describe('GET /me', () => {
  it.each([
    ['configured', null, 'unconfigured'],
    ['unconfigured', { mode: 'manual', check: Buffer.alloc(32), wrapped: null }, 'configured'],
  ] as const)(
    'returns the user, database %s and the key state',
    async (status, record, key: Me['key']) => {
      databaseStatus.mockResolvedValue(status);
      vi.mocked(getAppUserKey).mockResolvedValue(record);

      const response: globalThis.Response = await fetch(`${baseUrl}/me`, {
        headers: { 'x-test-user': 'alice' },
      });

      const expected: Me = { user: 'alice', database: status, key };
      expect(await response.json()).toEqual(expected);
      expect(databaseStatus).toHaveBeenLastCalledWith('alice');
      expect(getAppUserKey).toHaveBeenLastCalledWith('alice');
    },
  );
});
