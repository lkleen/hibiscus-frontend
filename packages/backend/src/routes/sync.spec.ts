import express, { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncConnectionStatus } from '@hibiscus-frontend/shared/contracts/sync';
import { PendingTanRegistry } from '../sync/pending-tan-registry';
import type { PendingChallenge } from '../sync/pending-tan-registry';
import { createSyncRouter } from './sync';

interface HttpResponse {
  status: number;
  body: unknown;
  contentType: string | null;
  bytes: Buffer;
}

const photoChallenge: PendingChallenge = {
  kind: 'phototan',
  message: 'Scannen',
  image: { mimeType: 'image/png', bytes: Buffer.from([137, 80, 78, 71]) },
  reference: 'ref',
  pollDelayMs: null,
};

const service = { status: vi.fn() };
let registry: PendingTanRegistry;
let server: ReturnType<Express['listen']>;
let baseUrl: string;

async function send(method: string, path: string, body?: unknown): Promise<HttpResponse> {
  const response: Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bytes: Buffer = Buffer.from(await response.arrayBuffer());
  const contentType: string | null = response.headers.get('content-type');
  const parsed: unknown = contentType?.includes('application/json')
    ? JSON.parse(bytes.toString('utf8'))
    : null;
  return { status: response.status, body: parsed, contentType, bytes };
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app: Express = express();
      app.use(express.json());
      // The router reads the registry through this indirection so each test gets a fresh one.
      app.use('/sync', (req: express.Request, res: express.Response, next: express.NextFunction) =>
        createSyncRouter({ service, registry })(req, res, next),
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
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

beforeEach(() => {
  vi.resetAllMocks();
  registry = new PendingTanRegistry(60_000);
});

describe('sync router GET /status', () => {
  it('returns the service status', async () => {
    const status: SyncConnectionStatus[] = [
      {
        id: 3,
        name: 'comdirect',
        enabled: true,
        pausedReason: null,
        lastSyncAt: null,
        lastStatus: null,
        lastError: null,
        latestRun: null,
        challenge: null,
      },
    ];
    service.status.mockResolvedValueOnce(status);

    const response: HttpResponse = await send('GET', '/sync/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(status);
  });
});

describe('sync router POST /runs/:id/tan', () => {
  it('passes the TAN to the waiting run', async () => {
    const answer: Promise<string | undefined> = registry
      .createPrompt({ runId: 41, connectionId: 3 })
      .request({ ...photoChallenge, kind: 'tan', image: null });

    const response: HttpResponse = await send('POST', '/sync/runs/41/tan', { tan: '123456' });

    expect(response.status).toBe(204);
    await expect(answer).resolves.toBe('123456');
  });

  it('acknowledges a decoupled challenge without a TAN', async () => {
    const answer: Promise<string | undefined> = registry
      .createPrompt({ runId: 41, connectionId: 3 })
      .request({ ...photoChallenge, kind: 'decoupled', image: null, pollDelayMs: 50_000 });

    const response: HttpResponse = await send('POST', '/sync/runs/41/tan', {});

    expect(response.status).toBe(204);
    await expect(answer).resolves.toBeUndefined();
    registry.release(41);
  });

  it('returns 400 when a typed challenge gets no TAN', async () => {
    void registry.createPrompt({ runId: 41, connectionId: 3 }).request(photoChallenge);

    expect((await send('POST', '/sync/runs/41/tan', {})).status).toBe(400);
    expect((await send('POST', '/sync/runs/41/tan', { tan: 5 })).status).toBe(400);
    registry.release(41);
  });

  it('returns 409 no-challenge when the run is not waiting', async () => {
    const response: HttpResponse = await send('POST', '/sync/runs/41/tan', { tan: '1' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'no-challenge' });
  });
});

describe('sync router GET /runs/:id/challenge-image', () => {
  it('returns the image bytes with their content type, uncached', async () => {
    void registry.createPrompt({ runId: 41, connectionId: 3 }).request(photoChallenge);

    const response: HttpResponse = await send('GET', '/sync/runs/41/challenge-image');

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('image/png');
    expect(response.bytes.equals(photoChallenge.image!.bytes)).toBe(true);
    registry.release(41);
  });

  it('returns 404 without an open image', async () => {
    expect((await send('GET', '/sync/runs/41/challenge-image')).status).toBe(404);
    expect((await send('GET', '/sync/runs/x/challenge-image')).status).toBe(400);
  });
});
