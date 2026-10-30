import { randomBytes } from 'node:crypto';
import express, { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BankConnection,
  BankConnectionCreateRequest,
  BankConnectionSettings,
  BankConnectionUpdateRequest,
  DiscoverDone,
} from '@hibiscus-frontend/shared/contracts/sync';
import { createBankConnectionsRouter } from './bank-connections';

vi.mock('../repositories/bank-connection', () => ({
  createBankConnection: vi.fn(),
  getBankConnection: vi.fn(),
  listBankConnections: vi.fn(),
  replaceBankConnectionAccounts: vi.fn(),
  updateBankConnection: vi.fn(),
}));

import {
  createBankConnection,
  getBankConnection,
  listBankConnections,
  replaceBankConnectionAccounts,
  updateBankConnection,
} from '../repositories/bank-connection';
import type { BankConnectionCreateParams } from '../repositories/bank-connection';
import { CredentialCrypto } from '../sync/credential-crypto';
import { ConflictError, NotFoundError } from '../sync/sync-service';
import type { SyncService } from '../sync/sync-service';

interface HttpResponse {
  status: number;
  body: unknown;
  text: string;
}

const PIN = 'pin-5521-secret';

const settings: BankConnectionSettings = {
  name: 'comdirect',
  blz: '20041177',
  fintsUrl: 'https://fints.comdirect.de/fints',
  loginName: 'user',
  customerId: null,
  tanMethod: null,
  tanMedia: null,
  syncIntervalHours: 6,
  enabled: true,
};
const connection: BankConnection = {
  id: 3,
  ...settings,
  accounts: [],
  pausedReason: null,
  lastSyncAt: null,
  lastStatus: null,
  lastError: null,
};
const discoverDone: DiscoverDone = {
  status: 'done',
  tanMethods: [],
  selectedTanMethod: 902,
  tanMedia: [],
  accounts: [],
};

const crypto: CredentialCrypto = new CredentialCrypto(randomBytes(32));
const service = {
  deleteConnection: vi.fn(),
  discover: vi.fn(),
  describeDiscovery: vi.fn(),
  startSync: vi.fn(),
};
const loggedErrors: unknown[][] = [];

let server: ReturnType<Express['listen']>;
let baseUrl: string;

async function send(method: string, path: string, body?: unknown): Promise<HttpResponse> {
  const response: Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text: string = await response.text();
  const contentType: string | null = response.headers.get('content-type');
  const parsed: unknown = contentType?.includes('application/json') ? JSON.parse(text) : null;
  return { status: response.status, body: parsed, text };
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app: Express = express();
      app.use(express.json());
      app.use(
        '/bank-connections',
        createBankConnectionsRouter({ service: service as unknown as SyncService, crypto }),
      );
      /* eslint-disable @typescript-eslint/no-unused-vars,@typescript-eslint/max-params */
      app.use(
        (
          err: Error,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ): void => {
          loggedErrors.push([err]);
          res.status(500).json({ error: 'Internal Server Error' });
        },
      );
      /* eslint-enable @typescript-eslint/no-unused-vars,@typescript-eslint/max-params */
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
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

beforeEach(() => {
  vi.resetAllMocks();
  loggedErrors.length = 0;
});

describe('bank-connections router GET /', () => {
  it('returns the connections', async () => {
    vi.mocked(listBankConnections).mockResolvedValueOnce([connection]);

    const response: HttpResponse = await send('GET', '/bank-connections');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([connection]);
  });
});

describe('bank-connections router POST /', () => {
  const createBody: BankConnectionCreateRequest = { ...settings, pin: PIN };

  it('stores the PIN encrypted and returns 201 without it', async () => {
    vi.mocked(createBankConnection).mockResolvedValueOnce(3);
    vi.mocked(getBankConnection).mockResolvedValueOnce(connection);

    const response: HttpResponse = await send('POST', '/bank-connections', createBody);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(connection);
    expect(response.text).not.toContain(PIN);
    const params: BankConnectionCreateParams = vi.mocked(createBankConnection).mock.calls[0]![0];
    expect(params.settings).toEqual(settings);
    expect(crypto.decrypt(params.pin)).toBe(PIN);
    expect(params.pin.ciphertext.toString('utf8')).not.toContain(PIN);
  });

  it.each([
    ['missing PIN', { ...settings }],
    ['blank name', { ...createBody, name: ' ' }],
    ['BLZ not 8 digits', { ...createBody, blz: '1234' }],
    ['http URL', { ...createBody, fintsUrl: 'http://bank.example/fints' }],
    ['interval 0', { ...createBody, syncIntervalHours: 0 }],
    ['unknown key', { ...createBody, extra: 1 }],
  ])('returns 400 for %s, never echoing the PIN', async (_label: string, body: unknown) => {
    const response: HttpResponse = await send('POST', '/bank-connections', body);

    expect(response.status).toBe(400);
    expect(response.text).not.toContain(PIN);
    expect(createBankConnection).not.toHaveBeenCalled();
  });

  it('never logs the PIN when storing fails', async () => {
    vi.mocked(createBankConnection).mockRejectedValueOnce(new Error('db down'));

    const response: HttpResponse = await send('POST', '/bank-connections', createBody);

    expect(response.status).toBe(500);
    expect(response.text).not.toContain(PIN);
    expect(JSON.stringify(loggedErrors.map(String))).not.toContain(PIN);
  });
});

describe('bank-connections router PUT /:id', () => {
  const updateBody: BankConnectionUpdateRequest = {
    expected: settings,
    next: { ...settings, name: 'Neu', tanMethod: 902 },
  };

  it('returns 204 and keeps the PIN when none is given', async () => {
    vi.mocked(updateBankConnection).mockResolvedValueOnce('updated');

    const response: HttpResponse = await send('PUT', '/bank-connections/3', updateBody);

    expect(response.status).toBe(204);
    expect(updateBankConnection).toHaveBeenCalledWith({
      id: 3,
      expected: settings,
      next: updateBody.next,
    });
  });

  it('replaces the PIN encrypted when given', async () => {
    vi.mocked(updateBankConnection).mockResolvedValueOnce('updated');

    await send('PUT', '/bank-connections/3', { ...updateBody, pin: PIN });

    const params = vi.mocked(updateBankConnection).mock.calls[0]![0];
    expect(params.pin).toBeDefined();
    expect(crypto.decrypt(params.pin!)).toBe(PIN);
  });

  it('returns 409 conflict and 404 not-found', async () => {
    vi.mocked(updateBankConnection).mockResolvedValueOnce('conflict');
    const conflict: HttpResponse = await send('PUT', '/bank-connections/3', updateBody);
    vi.mocked(updateBankConnection).mockResolvedValueOnce('not-found');
    const missing: HttpResponse = await send('PUT', '/bank-connections/3', updateBody);

    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ error: 'conflict' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'not-found' });
  });

  it('returns 400 for an invalid id or body', async () => {
    expect((await send('PUT', '/bank-connections/abc', updateBody)).status).toBe(400);
    expect((await send('PUT', '/bank-connections/3', { next: settings })).status).toBe(400);
    expect(updateBankConnection).not.toHaveBeenCalled();
  });
});

describe('bank-connections router DELETE /:id', () => {
  it('returns 204, or 404 when missing', async () => {
    service.deleteConnection.mockResolvedValueOnce(true);
    expect((await send('DELETE', '/bank-connections/3')).status).toBe(204);
    expect(service.deleteConnection).toHaveBeenCalledWith(3);
    service.deleteConnection.mockResolvedValueOnce(false);
    expect((await send('DELETE', '/bank-connections/3')).status).toBe(404);
  });

  it('returns 409 locked while a run holds the lock', async () => {
    service.deleteConnection.mockRejectedValueOnce(new ConflictError(3));

    const response: HttpResponse = await send('DELETE', '/bank-connections/3');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'locked' });
  });
});

describe('bank-connections router POST /:id/discover', () => {
  it('returns the discovery', async () => {
    service.discover.mockResolvedValueOnce(discoverDone);

    const response: HttpResponse = await send('POST', '/bank-connections/3/discover');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(discoverDone);
    expect(service.discover).toHaveBeenCalledWith(3);
  });

  it('returns 409 locked and 404 not-found', async () => {
    service.discover.mockRejectedValueOnce(new ConflictError(3));
    const locked: HttpResponse = await send('POST', '/bank-connections/3/discover');
    service.discover.mockRejectedValueOnce(new NotFoundError('x'));
    const missing: HttpResponse = await send('POST', '/bank-connections/3/discover');

    expect(locked.status).toBe(409);
    expect(locked.body).toEqual({ error: 'locked' });
    expect(missing.status).toBe(404);
  });
});

describe('bank-connections router GET /:id/discovery', () => {
  it('returns the stored discovery, or 404 without one', async () => {
    service.describeDiscovery.mockResolvedValueOnce(discoverDone);
    expect((await send('GET', '/bank-connections/3/discovery')).body).toEqual(discoverDone);
    service.describeDiscovery.mockResolvedValueOnce(null);
    expect((await send('GET', '/bank-connections/3/discovery')).status).toBe(404);
  });
});

describe('bank-connections router PUT /:id/accounts', () => {
  const accounts = [{ accountIdentifier: 'DE111', kontoId: 11, enabled: true }];

  it('replaces the mapping', async () => {
    vi.mocked(replaceBankConnectionAccounts).mockResolvedValueOnce('updated');

    expect((await send('PUT', '/bank-connections/3/accounts', { accounts })).status).toBe(204);
    expect(replaceBankConnectionAccounts).toHaveBeenCalledWith(3, accounts);
  });

  it('returns 400 for duplicate identifiers and for an unknown konto, 404 for no connection', async () => {
    const duplicate: HttpResponse = await send('PUT', '/bank-connections/3/accounts', {
      accounts: [...accounts, ...accounts],
    });
    vi.mocked(replaceBankConnectionAccounts).mockRejectedValueOnce(
      Object.assign(new Error('fk'), { code: 'ER_NO_REFERENCED_ROW_2' }),
    );
    const unknown: HttpResponse = await send('PUT', '/bank-connections/3/accounts', { accounts });
    vi.mocked(replaceBankConnectionAccounts).mockResolvedValueOnce('not-found');
    const missing: HttpResponse = await send('PUT', '/bank-connections/3/accounts', { accounts });

    expect(duplicate.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(missing.status).toBe(404);
  });
});

describe('bank-connections router POST /:id/sync', () => {
  it('returns 202 with the run id and logs a later failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail: (error: Error) => void = (): void => undefined;
    const done: Promise<void> = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    service.startSync.mockResolvedValueOnce({ runId: 41, done });

    const response: HttpResponse = await send('POST', '/bank-connections/3/sync');
    fail(new Error('later'));
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ runId: 41 });
    expect(service.startSync).toHaveBeenCalledWith(3, 'manual');
    consoleError.mockRestore();
  });

  it('returns 409 locked', async () => {
    service.startSync.mockRejectedValueOnce(new ConflictError(3));

    const response: HttpResponse = await send('POST', '/bank-connections/3/sync');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'locked' });
  });
});
