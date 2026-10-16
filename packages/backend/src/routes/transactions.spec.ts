import express, { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TransactionAssignRequest,
  TransactionUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { createTransactionsRouter } from './transactions';

vi.mock('../repositories/umsatz', () => ({
  listTransactions: vi.fn(),
  updateTransaction: vi.fn(),
  assignCategory: vi.fn(),
}));

import { assignCategory, updateTransaction } from '../repositories/umsatz';

interface PatchResponse {
  status: number;
  body: unknown;
}

let server: ReturnType<Express['listen']>;
let baseUrl: string;

const validBody: TransactionUpdateRequest = {
  expected: { kommentar: null, umsatztyp_id: 3 },
  next: { kommentar: 'Miete', umsatztyp_id: 4 },
};

async function send(method: string, path: string, body: unknown): Promise<PatchResponse> {
  const response: Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
      app.use(express.json({ limit: '5mb' }));
      app.use('/transactions', createTransactionsRouter());
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

function patch(path: string, body: unknown): Promise<PatchResponse> {
  return send('PATCH', path, body);
}

const assignBody: TransactionAssignRequest = {
  items: [
    { id: 1, expected: { kommentar: null, umsatztyp_id: 3 } },
    { id: 2, expected: { kommentar: 'x', umsatztyp_id: null } },
  ],
  umsatztyp_id: 7,
};

describe('transactions router PATCH /:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 and passes the id and body to the repository', async () => {
    vi.mocked(updateTransaction).mockResolvedValueOnce('updated');

    const response: PatchResponse = await patch('/transactions/42', validBody);

    expect(response.status).toBe(204);
    expect(updateTransaction).toHaveBeenCalledWith(42, validBody);
  });

  it.each(['0', '-1', 'abc', '1.5'])('returns 400 for the id %s', async (id: string) => {
    const response: PatchResponse = await patch(`/transactions/${id}`, validBody);

    expect(response.status).toBe(400);
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['missing expected', { next: validBody.next }],
    ['wrong type', { ...validBody, next: { kommentar: 5, umsatztyp_id: 1 } }],
    ['non-positive category', { ...validBody, next: { kommentar: null, umsatztyp_id: 0 } }],
    ['another column', { ...validBody, next: { kommentar: null, umsatztyp_id: 1, betrag: 1 } }],
  ])('returns 400 for an invalid body (%s)', async (_name: string, body: unknown) => {
    const response: PatchResponse = await patch('/transactions/42', body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid request' });
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the transaction does not exist', async () => {
    vi.mocked(updateTransaction).mockResolvedValueOnce('not-found');

    expect((await patch('/transactions/42', validBody)).status).toBe(404);
  });

  it('returns 409 when the row no longer holds the expected values', async () => {
    vi.mocked(updateTransaction).mockResolvedValueOnce('conflict');

    expect((await patch('/transactions/42', validBody)).status).toBe(409);
  });

  it('returns 400 for an unknown category (foreign key violation)', async () => {
    vi.mocked(updateTransaction).mockRejectedValueOnce(
      Object.assign(new Error('fk'), { code: 'ER_NO_REFERENCED_ROW_2' }),
    );

    expect((await patch('/transactions/42', validBody)).status).toBe(400);
  });

  it('returns 500 for any other repository error', async () => {
    vi.mocked(updateTransaction).mockRejectedValueOnce(new Error('boom'));

    expect((await patch('/transactions/42', validBody)).status).toBe(500);
  });
});

describe('transactions router POST /assign-category', () => {
  const post = (body: unknown): Promise<PatchResponse> =>
    send('POST', '/transactions/assign-category', body);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 and passes the body to the repository', async () => {
    vi.mocked(assignCategory).mockResolvedValueOnce({ result: 'assigned' });

    expect((await post(assignBody)).status).toBe(204);
    expect(assignCategory).toHaveBeenCalledWith(assignBody);
  });

  it.each([
    ['no items', { ...assignBody, items: [] }],
    ['duplicate ids', { ...assignBody, items: [assignBody.items[0], assignBody.items[0]] }],
    [
      'too many items',
      {
        ...assignBody,
        items: Array.from({ length: 10_001 }, (_v: unknown, i: number) => ({
          id: i + 1,
          expected: { kommentar: null, umsatztyp_id: null },
        })),
      },
    ],
    ['missing category', { items: assignBody.items }],
    ['non-positive category', { ...assignBody, umsatztyp_id: 0 }],
    ['extra key', { ...assignBody, kommentar: 'x' }],
  ])('returns 400 for an invalid body (%s)', async (_name: string, body: unknown) => {
    const response: PatchResponse = await post(body);

    expect(response.status).toBe(400);
    expect(assignCategory).not.toHaveBeenCalled();
  });

  it('returns 409 with the conflicting ids', async () => {
    vi.mocked(assignCategory).mockResolvedValueOnce({ result: 'conflict', conflictIds: [2] });

    const response: PatchResponse = await post(assignBody);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'conflict', conflictIds: [2] });
  });

  it('returns 400 for an unknown category (foreign key violation)', async () => {
    vi.mocked(assignCategory).mockRejectedValueOnce(
      Object.assign(new Error('fk'), { code: 'ER_NO_REFERENCED_ROW_2' }),
    );

    expect((await post(assignBody)).status).toBe(400);
  });

  it('returns 500 for any other repository error', async () => {
    vi.mocked(assignCategory).mockRejectedValueOnce(new Error('boom'));

    expect((await post(assignBody)).status).toBe(500);
  });
});
