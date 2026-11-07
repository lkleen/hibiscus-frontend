import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Me } from '@hibiscus-frontend/shared/contracts/user';

import { runWithUserContext } from '../db/pool';
import type { UserDatabases } from '../db/user-databases';
import type { AppUserRepository } from '../repositories/app-user';
import { createMeRouter } from './me';

const databaseStatus: Mock<UserDatabases['databaseStatus']> = vi.fn();
const getKey: Mock<AppUserRepository['getKey']> = vi.fn();
let server: ReturnType<Express['listen']>;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve: () => void) => {
      const app: Express = express();
      app.use((req: Request, _res: Response, next: NextFunction): void => {
        runWithUserContext({ user: String(req.headers['x-test-user']), database: null }, next);
      });
      app.use(
        '/me',
        createMeRouter({
          databases: { databaseStatus },
          appUsers: { getKey },
          dataSource: 'demo',
        }),
      );
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
    'returns the user, database %s, the key state and the data source',
    async (status, record, key: Me['key']) => {
      databaseStatus.mockResolvedValue(status);
      getKey.mockResolvedValue(record);

      const response: globalThis.Response = await fetch(`${baseUrl}/me`, {
        headers: { 'x-test-user': 'alice' },
      });

      const expected: Me = { user: 'alice', database: status, key, dataSource: 'demo' };
      expect(await response.json()).toEqual(expected);
      expect(databaseStatus).toHaveBeenLastCalledWith('alice');
      expect(getKey).toHaveBeenLastCalledWith('alice');
    },
  );
});
