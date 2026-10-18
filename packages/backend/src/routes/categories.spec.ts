import express, { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CategoryEditableFields,
  CategoryRow,
  CategoryUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/categories';
import { createCategoriesRouter } from './categories';

vi.mock('../repositories/umsatztyp', () => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}));

import { createCategory, updateCategory } from '../repositories/umsatztyp';

interface HttpResponse {
  status: number;
  body: unknown;
}

let server: ReturnType<Express['listen']>;
let baseUrl: string;

const fields: CategoryEditableFields = {
  name: 'Food',
  nummer: null,
  pattern: null,
  isregex: null,
  umsatztyp: 0,
  parent_id: null,
  color: '255,0,10',
  customcolor: 1,
  kommentar: null,
  konto_id: null,
  konto_kategorie: null,
  flags: null,
};
const validBody: CategoryUpdateRequest = { expected: fields, next: { ...fields, name: 'Meals' } };

async function send(method: string, path: string, body: unknown): Promise<HttpResponse> {
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
      app.use('/categories', createCategoriesRouter());
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

function fkError(constraint: string): Error {
  return Object.assign(
    new Error(`Cannot add or update a child row: CONSTRAINT \`${constraint}\``),
    {
      code: 'ER_NO_REFERENCED_ROW_2',
    },
  );
}

describe('categories router POST /', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 with the created row', async () => {
    const created: CategoryRow = { id: 5, ...fields };
    vi.mocked(createCategory).mockResolvedValueOnce(created);

    const response: HttpResponse = await send('POST', '/categories', fields);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(created);
    expect(createCategory).toHaveBeenCalledWith(fields);
  });

  it.each([
    ['empty name', { ...fields, name: '   ' }],
    ['overlong nummer', { ...fields, nummer: '123456' }],
    ['bad color', { ...fields, color: '256,0,0' }],
    ['bad umsatztyp', { ...fields, umsatztyp: 3 }],
    ['unknown key', { ...fields, id: 1 }],
    ['non-positive parent', { ...fields, parent_id: 0 }],
  ])('returns 400 for %s', async (_label: string, body: unknown) => {
    const response: HttpResponse = await send('POST', '/categories', body);

    expect(response.status).toBe(400);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('trims the name', async () => {
    vi.mocked(createCategory).mockResolvedValueOnce({ id: 5, ...fields });

    await send('POST', '/categories', { ...fields, name: '  Food ' });

    expect(createCategory).toHaveBeenCalledWith(fields);
  });

  it('returns 400 for an unknown parent or account', async () => {
    vi.mocked(createCategory).mockRejectedValueOnce(fkError('fk_umsatztyp_umsatztyp'));
    expect((await send('POST', '/categories', fields)).body).toEqual({ error: 'Unknown parent' });

    vi.mocked(createCategory).mockRejectedValueOnce(fkError('fk_umsatztyp_konto'));
    expect((await send('POST', '/categories', fields)).body).toEqual({ error: 'Unknown account' });
  });

  it('returns 500 for other errors', async () => {
    vi.mocked(createCategory).mockRejectedValueOnce(new Error('boom'));

    expect((await send('POST', '/categories', fields)).status).toBe(500);
  });
});

describe('categories router PUT /:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 and passes id and body to the repository', async () => {
    vi.mocked(updateCategory).mockResolvedValueOnce('updated');

    const response: HttpResponse = await send('PUT', '/categories/42', validBody);

    expect(response.status).toBe(204);
    expect(updateCategory).toHaveBeenCalledWith(42, validBody);
  });

  it('returns 400 { error: cycle } on a cycle', async () => {
    vi.mocked(updateCategory).mockResolvedValueOnce('cycle');

    const response: HttpResponse = await send('PUT', '/categories/42', validBody);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'cycle' });
  });

  it('returns 404 and 409 for not-found and conflict', async () => {
    vi.mocked(updateCategory).mockResolvedValueOnce('not-found');
    expect((await send('PUT', '/categories/42', validBody)).status).toBe(404);

    vi.mocked(updateCategory).mockResolvedValueOnce('conflict');
    const response: HttpResponse = await send('PUT', '/categories/42', validBody);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'conflict' });
  });

  it.each(['abc', '0', '-1', '1.5'])('returns 400 for id %s', async (id: string) => {
    const response: HttpResponse = await send('PUT', `/categories/${id}`, validBody);

    expect(response.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid or incomplete body', async () => {
    expect((await send('PUT', '/categories/42', { next: fields })).status).toBe(400);
    expect((await send('PUT', '/categories/42', { ...validBody, extra: 1 })).status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown parent or account', async () => {
    vi.mocked(updateCategory).mockRejectedValueOnce(fkError('fk_umsatztyp_umsatztyp'));
    const response: HttpResponse = await send('PUT', '/categories/42', validBody);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Unknown parent' });
  });

  it('returns 500 for other errors', async () => {
    vi.mocked(updateCategory).mockRejectedValueOnce(new Error('boom'));

    expect((await send('PUT', '/categories/42', validBody)).status).toBe(500);
  });
});
