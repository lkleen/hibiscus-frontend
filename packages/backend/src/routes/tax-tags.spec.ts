import express, { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaxTagsUpdateRequest } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { createTaxTagsRouter } from './tax-tags';

vi.mock('../repositories/tax-tag', () => ({
  listTaxTags: vi.fn(),
  applyTaxTagChanges: vi.fn(),
}));

import { applyTaxTagChanges, listTaxTags } from '../repositories/tax-tag';

interface HttpResponse {
  status: number;
  body: unknown;
}

let server: ReturnType<Express['listen']>;
let baseUrl: string;

async function send(method: string, body?: unknown): Promise<HttpResponse> {
  const response: Response = await fetch(`${baseUrl}/tax-tags`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType: string | null = response.headers.get('content-type');
  const responseBody: unknown = contentType?.includes('application/json')
    ? await response.json()
    : null;
  return { status: response.status, body: responseBody };
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app: Express = express();
      app.use(express.json());
      app.use('/tax-tags', createTaxTagsRouter());
      /* eslint-disable @typescript-eslint/no-unused-vars,@typescript-eslint/max-params */
      app.use(
        (
          _err: Error,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ): void => {
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

const validBody: TaxTagsUpdateRequest = {
  changes: [
    { category_id: 1, expected: null, next: 'St-WK' },
    { category_id: 2, expected: 'St-SA', next: null },
  ],
};

describe('tax-tags router GET /', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with the tags', async () => {
    vi.mocked(listTaxTags).mockResolvedValueOnce([{ category_id: 1, code: 'St-WK' }]);

    const response: HttpResponse = await send('GET');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ category_id: 1, code: 'St-WK' }]);
  });

  it('returns 500 when the repository fails', async () => {
    vi.mocked(listTaxTags).mockRejectedValueOnce(new Error('boom'));

    expect((await send('GET')).status).toBe(500);
  });
});

describe('tax-tags router PUT /', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 and passes the body to the repository', async () => {
    vi.mocked(applyTaxTagChanges).mockResolvedValueOnce({ result: 'saved' });

    expect((await send('PUT', validBody)).status).toBe(204);
    expect(applyTaxTagChanges).toHaveBeenCalledWith(validBody);
  });

  it.each([
    ['no changes', { changes: [] }],
    [
      'too many changes',
      {
        changes: Array.from({ length: 501 }, (_v: unknown, i: number) => ({
          category_id: i + 1,
          expected: null,
          next: 'St-WK',
        })),
      },
    ],
    ['duplicate category ids', { changes: [validBody.changes[0], validBody.changes[0]] }],
    ['expected equals next', { changes: [{ category_id: 1, expected: 'St-WK', next: 'St-WK' }] }],
    ['both null', { changes: [{ category_id: 1, expected: null, next: null }] }],
    ['unknown code', { changes: [{ category_id: 1, expected: null, next: 'St-X' }] }],
    ['non-positive id', { changes: [{ category_id: 0, expected: null, next: 'St-WK' }] }],
    ['extra key on body', { ...validBody, foo: 1 }],
    [
      'extra key on change',
      { changes: [{ category_id: 1, expected: null, next: 'St-WK', foo: 1 }] },
    ],
    ['missing changes', {}],
  ])('returns 400 for an invalid body (%s)', async (_name: string, body: unknown) => {
    const response: HttpResponse = await send('PUT', body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid request' });
    expect(applyTaxTagChanges).not.toHaveBeenCalled();
  });

  it('returns 409 with the conflicting ids', async () => {
    vi.mocked(applyTaxTagChanges).mockResolvedValueOnce({ result: 'conflict', conflictIds: [2] });

    const response: HttpResponse = await send('PUT', validBody);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'conflict', conflictIds: [2] });
  });

  it('returns 500 for a repository error', async () => {
    vi.mocked(applyTaxTagChanges).mockRejectedValueOnce(new Error('boom'));

    expect((await send('PUT', validBody)).status).toBe(500);
  });
});
