import { randomBytes } from 'node:crypto';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserKeyStatus } from '@hibiscus-frontend/shared/contracts/user';

vi.mock('../repositories/app-user', () => ({
  createAppUserKey: vi.fn(),
  deleteAppUserKey: vi.fn(),
  getAppUserKey: vi.fn(),
  updateAppUserKey: vi.fn(),
}));
vi.mock('../repositories/bank-connection', () => ({
  clearBankConnectionPins: vi.fn(),
  reencryptBankConnectionPins: vi.fn(),
}));

import { currentUser, runWithUserContext } from '../db/pool';
import type { UserDatabaseHandle } from '../db/pool';
import { markUserBusy, unmarkUserBusy } from '../db/user-activity';
import type { UserDatabaseLookup } from '../db/user-pools';
import {
  createAppUserKey,
  deleteAppUserKey,
  getAppUserKey,
  updateAppUserKey,
} from '../repositories/app-user';
import type { AppUserKeyRecord, AppUserKeyUpdate } from '../repositories/app-user';
import {
  clearBankConnectionPins,
  reencryptBankConnectionPins,
} from '../repositories/bank-connection';
import type { PinReencryption } from '../repositories/bank-connection';
import { CredentialCrypto } from '../sync/credential-crypto';
import type { EncryptedSecret } from '../sync/credential-crypto';
import {
  decodeUserKey,
  decryptPin,
  encryptPin,
  userKeyCheck,
  UserKeys,
  UserKeyStore,
} from '../sync/user-keys';
import { createUserKeyRouter } from './user-key';

interface HttpResponse {
  status: number;
  body: unknown;
  text: string;
}

const USER = 'alice';
const PIN = 'pin-8080-secret';
const database: UserDatabaseHandle = {} as UserDatabaseHandle;

const serverCrypto: CredentialCrypto = new CredentialCrypto(randomBytes(32));
const acquire = vi.fn<(user: string) => Promise<UserDatabaseLookup>>();
const loggedErrors: unknown[] = [];
let keyRow: AppUserKeyRecord | null;
let pin: EncryptedSecret | null;
/** The database the PIN work ran with, as the context showed it. */
let pinContext: UserDatabaseHandle | null | undefined;
let store: UserKeyStore;
let server: ReturnType<Express['listen']>;
let baseUrl: string;

async function send(method: string, path: string, body?: unknown): Promise<HttpResponse> {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text: string = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null, text };
}

function keyText(): string {
  return randomBytes(32).toString('base64');
}

function configure(mode: AppUserKeyRecord['mode'], text: string): void {
  const key: Buffer = decodeUserKey(text);
  keyRow = {
    mode,
    check: userKeyCheck(key),
    wrapped: mode === 'stored' ? serverCrypto.encrypt(text) : null,
  };
  pin = encryptPin(key, PIN);
}

beforeAll(
  () =>
    new Promise<void>((resolve: () => void) => {
      const app: Express = express();
      app.use(express.json());
      app.use((_req: Request, _res: Response, next: NextFunction): void => {
        runWithUserContext({ user: USER, database: null }, next);
      });
      app.use('/user/key', (req: Request, res: Response, next: NextFunction) =>
        createUserKeyRouter({ keys: new UserKeys({ serverCrypto, store }), pools: { acquire } })(
          req,
          res,
          next,
        ),
      );
      // eslint-disable-next-line @typescript-eslint/max-params, @typescript-eslint/no-unused-vars
      app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
        loggedErrors.push(err);
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
  loggedErrors.length = 0;
  keyRow = null;
  pin = null;
  pinContext = undefined;
  store = new UserKeyStore();
  acquire.mockResolvedValue({ status: 'configured', database });
  vi.mocked(getAppUserKey).mockImplementation(async () => keyRow);
  vi.mocked(createAppUserKey).mockImplementation(
    async (_user: string, record: AppUserKeyRecord) => {
      if (keyRow !== null) return false;
      keyRow = record;
      return true;
    },
  );
  vi.mocked(updateAppUserKey).mockImplementation(
    async (_user: string, update: AppUserKeyUpdate) => {
      if (keyRow === null || !keyRow.check.equals(update.expectedCheck)) {
        throw new Error('The key changed');
      }
      keyRow = update.next;
    },
  );
  vi.mocked(deleteAppUserKey).mockImplementation(async () => {
    keyRow = null;
  });
  vi.mocked(reencryptBankConnectionPins).mockImplementation(async (params: PinReencryption) => {
    pinContext = currentUser().database;
    const next: EncryptedSecret | null = pin === null ? null : params.reencrypt(pin);
    await params.beforeCommit();
    pin = next;
    return next === null ? 0 : 1;
  });
  vi.mocked(clearBankConnectionPins).mockImplementation(async () => {
    pinContext = currentUser().database;
    pin = null;
    return 1;
  });
});

describe('GET /user/key', () => {
  it('answers the key status', async () => {
    configure('memory', keyText());

    const response: HttpResponse = await send('GET', '/user/key');

    const body: UserKeyStatus = { configured: true, mode: 'memory', state: 'locked' };
    expect(response).toMatchObject({ status: 200, body });
  });
});

describe('POST /user/key', () => {
  it('answers 201 with a generated key, stored only as its check value', async () => {
    const response: HttpResponse = await send('POST', '/user/key', { mode: 'manual' });

    expect(response.status).toBe(201);
    const key: Buffer = decodeUserKey((response.body as { key: string }).key);
    expect(keyRow?.check.equals(userKeyCheck(key))).toBe(true);
  });

  it('answers 409 key-configured for a second key', async () => {
    configure('manual', keyText());

    const response: HttpResponse = await send('POST', '/user/key', { mode: 'stored' });

    expect(response).toMatchObject({ status: 409, body: { error: 'key-configured' } });
  });

  it('answers 400 key-invalid without echoing the key, and 400 for a bad body', async () => {
    const text: string = randomBytes(16).toString('base64');
    const invalid: HttpResponse = await send('POST', '/user/key', { key: text, mode: 'manual' });
    const badMode: HttpResponse = await send('POST', '/user/key', { key: text, mode: 'disk' });

    expect(invalid).toMatchObject({ status: 400, body: { error: 'key-invalid' } });
    expect(badMode.status).toBe(400);
    for (const response of [invalid, badMode]) expect(response.text).not.toContain(text);
    expect(keyRow).toBeNull();
  });
});

describe('PUT /user/key/mode', () => {
  it('needs the key for stored mode', async () => {
    const text: string = keyText();
    configure('manual', text);

    const missing: HttpResponse = await send('PUT', '/user/key/mode', { mode: 'stored' });
    const wrong: HttpResponse = await send('PUT', '/user/key/mode', {
      mode: 'stored',
      key: keyText(),
    });
    const done: HttpResponse = await send('PUT', '/user/key/mode', { mode: 'stored', key: text });

    expect(missing).toMatchObject({ status: 400, body: { error: 'key-required' } });
    expect(wrong).toMatchObject({ status: 400, body: { error: 'key-invalid' } });
    expect(done.status).toBe(204);
    expect(done.text).toBe('');
    expect(keyRow?.mode).toBe('stored');
  });

  it('answers 409 key-not-configured without a key', async () => {
    const response: HttpResponse = await send('PUT', '/user/key/mode', { mode: 'manual' });

    expect(response).toMatchObject({ status: 409, body: { error: 'key-not-configured' } });
  });
});

describe('POST /user/key/unlock and /lock', () => {
  it('unlocks with the right key and locks again', async () => {
    const text: string = keyText();
    configure('memory', text);

    const wrong: HttpResponse = await send('POST', '/user/key/unlock', { key: keyText() });
    expect(wrong).toMatchObject({ status: 400, body: { error: 'key-invalid' } });
    expect(store.has(USER)).toBe(false);

    expect((await send('POST', '/user/key/unlock', { key: text })).status).toBe(204);
    expect(store.has(USER)).toBe(true);
    expect((await send('POST', '/user/key/lock')).status).toBe(204);
    expect(store.has(USER)).toBe(false);
  });

  it('refuses to unlock outside memory mode', async () => {
    const text: string = keyText();
    configure('manual', text);

    const response: HttpResponse = await send('POST', '/user/key/unlock', { key: text });

    expect(response).toMatchObject({ status: 400, body: { error: 'Invalid request' } });
    expect(response.text).not.toContain(text);
  });
});

describe('POST /user/key/change', () => {
  it('re-encrypts the PINs in the user’s database and answers the new key', async () => {
    const oldText: string = keyText();
    configure('manual', oldText);

    const response: HttpResponse = await send('POST', '/user/key/change', { oldKey: oldText });

    expect(response.status).toBe(200);
    const newText: string = (response.body as { key: string }).key;
    expect(newText).not.toBe(oldText);
    expect(response.text).not.toContain(oldText);
    expect(decryptPin(decodeUserKey(newText), pin!)).toBe(PIN);
    expect(acquire).toHaveBeenCalledWith(USER);
    expect(pinContext).toBe(database);
  });

  it('answers a wrong old key with 400 key-invalid and touches no PIN', async () => {
    const oldText: string = keyText();
    configure('manual', oldText);
    const before: EncryptedSecret | null = pin;
    const wrongText: string = keyText();

    const response: HttpResponse = await send('POST', '/user/key/change', {
      oldKey: wrongText,
      newKey: keyText(),
    });

    expect(response).toMatchObject({ status: 400, body: { error: 'key-invalid' } });
    expect(response.text).not.toContain(wrongText);
    expect(reencryptBankConnectionPins).not.toHaveBeenCalled();
    expect(pin).toBe(before);
  });

  it('answers 409 busy while a sync runs', async () => {
    const oldText: string = keyText();
    configure('manual', oldText);
    markUserBusy(USER);
    try {
      const response: HttpResponse = await send('POST', '/user/key/change', { oldKey: oldText });
      expect(response).toMatchObject({ status: 409, body: { error: 'busy' } });
    } finally {
      unmarkUserBusy(USER);
    }
    expect(reencryptBankConnectionPins).not.toHaveBeenCalled();
  });

  it('answers 400 host-not-allowed when the database left the allowlist', async () => {
    const oldText: string = keyText();
    configure('manual', oldText);
    const row: AppUserKeyRecord | null = keyRow;
    acquire.mockResolvedValueOnce({ status: 'host-not-allowed' });

    const response: HttpResponse = await send('POST', '/user/key/change', { oldKey: oldText });

    expect(response).toMatchObject({ status: 400, body: { error: 'host-not-allowed' } });
    expect(keyRow).toBe(row);
  });

  it('never logs a key when the change fails', async () => {
    const oldText: string = keyText();
    const newText: string = keyText();
    configure('manual', oldText);
    vi.mocked(reencryptBankConnectionPins).mockRejectedValueOnce(new Error('db down'));

    const response: HttpResponse = await send('POST', '/user/key/change', {
      oldKey: oldText,
      newKey: newText,
    });

    expect(response.status).toBe(500);
    const logged: string = loggedErrors
      .map((error: unknown) => `${String(error)} ${(error as Error).stack}`)
      .join();
    for (const secret of [oldText, newText, PIN]) {
      expect(response.text).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
  });
});

describe('POST /user/key/reset', () => {
  it('deletes the PINs in the user’s database and the key', async () => {
    configure('stored', keyText());

    const response: HttpResponse = await send('POST', '/user/key/reset');

    expect(response.status).toBe(204);
    expect(pin).toBeNull();
    expect(pinContext).toBe(database);
    expect(keyRow).toBeNull();
  });

  it('only deletes the key for a user without a database', async () => {
    configure('manual', keyText());
    acquire.mockResolvedValueOnce({ status: 'unconfigured' });

    expect((await send('POST', '/user/key/reset')).status).toBe(204);
    expect(clearBankConnectionPins).not.toHaveBeenCalled();
    expect(keyRow).toBeNull();
  });

  it('answers 409 busy while a sync runs', async () => {
    configure('manual', keyText());
    markUserBusy(USER);
    try {
      const response: HttpResponse = await send('POST', '/user/key/reset');
      expect(response).toMatchObject({ status: 409, body: { error: 'busy' } });
    } finally {
      unmarkUserBusy(USER);
    }
    expect(clearBankConnectionPins).not.toHaveBeenCalled();
    expect(keyRow).not.toBeNull();
  });
});
