import express, { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaxTagsRouter } from './tax-tags';

vi.mock('../repositories/tax-tag', () => ({
  listTaxTags: vi.fn(),
}));

import { listTaxTags } from '../repositories/tax-tag';

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

describe('tax-tags router writes', () => {
  it('has no PUT: tags are saved with their category', async () => {
    expect((await send('PUT', [])).status).toBe(404);
  });
});
