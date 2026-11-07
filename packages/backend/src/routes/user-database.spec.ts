import { randomBytes } from 'node:crypto';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type {
  UserDatabaseTestResponse,
  UserDatabaseUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/user';

import { runWithUserContext } from '../db/pool';
import type { DatabaseTarget } from '../db/pool';
import { isReconfiguring, markUserBusy, unmarkUserBusy, UserBusyError } from '../db/user-activity';
import type { AppUserDatabaseWrite, AppUserRepository } from '../repositories/app-user';
import { DuplicateKeyError } from '../repositories/repository-errors';
import { CredentialCrypto } from '../sync/credential-crypto';
import { createUserDatabaseRouter } from './user-database';
import type { UserDatabaseRouterDeps } from './user-database';

interface HttpResponse {
  status: number;
  body: unknown;
  text: string;
}

const PASSWORD = 'db-pass-4711-secret';
const STORED_PASSWORD = 'stored-pass-0815';
const USER = 'alice';

const crypto: CredentialCrypto = new CredentialCrypto(randomBytes(32));
const invalidate: Mock<(username: string) => void> = vi.fn();
const appUsers: {
  getDatabase: Mock<AppUserRepository['getDatabase']>;
  isDatabaseUsedByOther: Mock<AppUserRepository['isDatabaseUsedByOther']>;
  saveDatabase: Mock<AppUserRepository['saveDatabase']>;
} = { getDatabase: vi.fn(), isDatabaseUsedByOther: vi.fn(), saveDatabase: vi.fn() };
let test: Mock<(target: DatabaseTarget) => Promise<UserDatabaseTestResponse>>;
let server: ReturnType<Express['listen']>;
let baseUrl: string;

const withoutPassword: UserDatabaseUpdateRequest = {
  host: 'Hibiscus-DB',
  port: 3306,
  name: 'alice',
  user: 'alice',
};
const request: UserDatabaseUpdateRequest = { ...withoutPassword, password: PASSWORD };

async function send(method: string, path: string, body?: unknown): Promise<HttpResponse> {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text: string = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null, text };
}

function storePassword(): void {
  appUsers.getDatabase.mockResolvedValue({
    settings: { host: 'hibiscus-db', port: 3306, name: 'alice', user: 'alice' },
    password: crypto.encrypt(STORED_PASSWORD),
    version: 3,
  });
}

beforeAll(
  () =>
    new Promise<void>((resolve: () => void) => {
      const app: Express = express();
      app.use(express.json());
      app.use((_req: Request, _res: Response, next: NextFunction): void => {
        runWithUserContext({ user: USER, database: null }, next);
      });
      const deps: UserDatabaseRouterDeps = {
        databases: { invalidate },
        appUsers,
        crypto,
        allowedHosts: [
          { host: 'hibiscus-db', port: null },
          { host: '10.0.0.5', port: 3307 },
        ],
        test: (target: DatabaseTarget) => test(target),
        dataSource: 'mariadb',
      };
      app.use('/user/database', createUserDatabaseRouter(deps));
      app.use('/demo/user/database', createUserDatabaseRouter({ ...deps, dataSource: 'demo' }));
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
  appUsers.getDatabase.mockResolvedValue(null);
  test = vi.fn().mockResolvedValue({ ok: true, hibiscusSchema: true, error: null });
});

afterEach(() => {
  // Leaves no busy mark behind for the next test.
  try {
    unmarkUserBusy(USER);
  } catch {
    // Not marked: nothing to clear.
  }
});

describe('GET /user/database', () => {
  it('answers null and the allowlist before the database is set up', async () => {
    const response: HttpResponse = await send('GET', '/user/database');

    expect(response).toMatchObject({
      status: 200,
      body: { database: null, allowedHosts: ['hibiscus-db', '10.0.0.5:3307'] },
    });
  });

  it('returns the settings with passwordSet and never the password', async () => {
    storePassword();

    const response: HttpResponse = await send('GET', '/user/database');

    expect(response.body).toEqual({
      database: {
        host: 'hibiscus-db',
        port: 3306,
        name: 'alice',
        user: 'alice',
        passwordSet: true,
      },
      allowedHosts: ['hibiscus-db', '10.0.0.5:3307'],
    });
    expect(response.text).not.toContain(STORED_PASSWORD);
  });
});

describe('POST /user/database/test', () => {
  it('tests the sent settings and passes the result through', async () => {
    test.mockResolvedValue({ ok: true, hibiscusSchema: false, error: null });

    const response: HttpResponse = await send('POST', '/user/database/test', request);

    expect(response).toMatchObject({
      status: 200,
      body: { ok: true, hibiscusSchema: false, error: null },
    });
    expect(test).toHaveBeenCalledWith({ ...request, host: 'Hibiscus-DB' });
  });

  it('uses the stored password when none is sent', async () => {
    storePassword();
    await send('POST', '/user/database/test', withoutPassword);

    expect(test.mock.calls[0]?.[0].password).toBe(STORED_PASSWORD);
  });

  it.each([
    ['an unknown host', { host: 'evil-db' }],
    ['a host that only ends like an allowed one', { host: 'x.hibiscus-db' }],
    ['an allowed host on another port', { host: '10.0.0.5', port: 3306 }],
  ])('rejects %s with host-not-allowed', async (_label: string, change: object) => {
    const response: HttpResponse = await send('POST', '/user/database/test', {
      ...request,
      ...change,
    });

    expect(response).toMatchObject({ status: 400, body: { error: 'host-not-allowed' } });
    expect(test).not.toHaveBeenCalled();
  });

  it('never echoes the password, not even in a validation error', async () => {
    const response: HttpResponse = await send('POST', '/user/database/test', {
      ...request,
      port: 'not a port',
    });

    expect(response.status).toBe(400);
    expect(response.text).not.toContain(PASSWORD);
  });
});

describe('PUT /user/database', () => {
  it('answers 409 database-in-use when another user has the database', async () => {
    appUsers.isDatabaseUsedByOther.mockResolvedValue(true);

    const response: HttpResponse = await send('PUT', '/user/database', request);

    expect(response).toMatchObject({ status: 409, body: { error: 'database-in-use' } });
    expect(appUsers.saveDatabase).not.toHaveBeenCalled();
  });

  it('answers 409 database-in-use when the unique key rejects a concurrent save', async () => {
    appUsers.saveDatabase.mockRejectedValue(new DuplicateKeyError('The database of another user'));

    const response: HttpResponse = await send('PUT', '/user/database', request);

    expect(response).toMatchObject({ status: 409, body: { error: 'database-in-use' } });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('tests, saves the password encrypted and drops the old pool', async () => {
    const response: HttpResponse = await send('PUT', '/user/database', request);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    const write: AppUserDatabaseWrite | undefined = appUsers.saveDatabase.mock.calls[0]?.[0];
    expect(write?.username).toBe(USER);
    expect(write?.settings).toEqual({
      host: 'Hibiscus-DB',
      port: 3306,
      name: 'alice',
      user: 'alice',
    });
    expect(write?.password.ciphertext.toString('utf8')).not.toContain(PASSWORD);
    expect(write === undefined ? null : crypto.decrypt(write.password)).toBe(PASSWORD);
    expect(invalidate).toHaveBeenCalledWith(USER);
  });

  it('keeps the stored password when none is sent', async () => {
    storePassword();
    expect((await send('PUT', '/user/database', withoutPassword)).status).toBe(204);

    const write: AppUserDatabaseWrite | undefined = appUsers.saveDatabase.mock.calls[0]?.[0];
    expect(write === undefined ? null : crypto.decrypt(write.password)).toBe(STORED_PASSWORD);
  });

  it('requires the password the first time', async () => {
    const response: HttpResponse = await send('PUT', '/user/database', withoutPassword);

    expect(response).toMatchObject({
      status: 400,
      body: { error: 'Invalid request', details: { fieldErrors: { password: ['Required'] } } },
    });
    expect(test).not.toHaveBeenCalled();
    expect(appUsers.saveDatabase).not.toHaveBeenCalled();
  });

  it('refuses a host off the allowlist without testing or saving', async () => {
    const response: HttpResponse = await send('PUT', '/user/database', {
      ...request,
      host: 'evil-db',
    });

    expect(response).toMatchObject({ status: 400, body: { error: 'host-not-allowed' } });
    expect(test).not.toHaveBeenCalled();
    expect(appUsers.saveDatabase).not.toHaveBeenCalled();
  });

  it('answers a failing test with 400 and the test result, without saving', async () => {
    test.mockResolvedValue({ ok: false, hibiscusSchema: false, error: 'Access denied' });

    const response: HttpResponse = await send('PUT', '/user/database', request);

    expect(response).toMatchObject({
      status: 400,
      body: { ok: false, hibiscusSchema: false, error: 'Access denied' },
    });
    expect(response.text).not.toContain(PASSWORD);
    expect(appUsers.saveDatabase).not.toHaveBeenCalled();
  });

  it('refuses a database without the Hibiscus tables', async () => {
    test.mockResolvedValue({ ok: true, hibiscusSchema: false, error: null });

    expect((await send('PUT', '/user/database', request)).status).toBe(400);
    expect(appUsers.saveDatabase).not.toHaveBeenCalled();
  });

  it('answers 409 busy while a sync of the user runs', async () => {
    markUserBusy(USER);

    const response: HttpResponse = await send('PUT', '/user/database', request);

    expect(response).toMatchObject({ status: 409, body: { error: 'busy' } });
    expect(appUsers.saveDatabase).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refuses a sync start while the settings are tested and saved', async () => {
    let syncRefused: unknown = null;
    test.mockImplementation(async () => {
      syncRefused = ((): unknown => {
        try {
          markUserBusy(USER);
          return null;
        } catch (error: unknown) {
          return error;
        }
      })();
      return { ok: true, hibiscusSchema: true, error: null };
    });

    const response: HttpResponse = await send('PUT', '/user/database', request);

    expect(response.status).toBe(204);
    expect(syncRefused).toBeInstanceOf(UserBusyError);
    expect(isReconfiguring(USER)).toBe(false);
  });

  it('answers 409 busy to a second save while the first one runs', async () => {
    let release: () => void = (): void => undefined;
    test.mockImplementationOnce(
      () =>
        new Promise<UserDatabaseTestResponse>((resolve) => {
          release = () => resolve({ ok: true, hibiscusSchema: true, error: null });
        }),
    );

    const first: Promise<HttpResponse> = send('PUT', '/user/database', request);
    await vi.waitFor(() => expect(test).toHaveBeenCalledTimes(1));
    const second: HttpResponse = await send('PUT', '/user/database', request);
    release();

    expect(second).toMatchObject({ status: 409, body: { error: 'busy' } });
    expect((await first).status).toBe(204);
    expect(appUsers.saveDatabase).toHaveBeenCalledTimes(1);
  });

  it('ends the reconfiguration when saving fails', async () => {
    appUsers.saveDatabase.mockRejectedValueOnce(new Error('app db down'));

    expect((await send('PUT', '/user/database', request)).status).toBe(500);
    expect(isReconfiguring(USER)).toBe(false);
  });
});

describe('/user/database with the demo data', () => {
  it('keeps answering GET', async () => {
    storePassword();

    const response: HttpResponse = await send('GET', '/demo/user/database');

    expect(response).toMatchObject({ status: 200, body: { database: { passwordSet: true } } });
  });

  it('answers 409 demo-mode to a test and connects nowhere', async () => {
    const response: HttpResponse = await send('POST', '/demo/user/database/test', request);

    expect(response).toEqual({
      status: 409,
      body: { error: 'demo-mode' },
      text: expect.any(String),
    });
    expect(test).not.toHaveBeenCalled();
  });

  it('answers 409 demo-mode to a save and saves nothing', async () => {
    const response: HttpResponse = await send('PUT', '/demo/user/database', request);

    expect(response).toEqual({
      status: 409,
      body: { error: 'demo-mode' },
      text: expect.any(String),
    });
    expect(test).not.toHaveBeenCalled();
    expect(appUsers.saveDatabase).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
