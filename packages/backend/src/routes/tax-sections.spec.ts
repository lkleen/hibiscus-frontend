import express, { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TaxSection,
  TaxSectionUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { createTaxSectionsRouter } from './tax-sections';

vi.mock('../repositories/tax-section', () => ({
  listTaxSections: vi.fn(),
  createTaxSection: vi.fn(),
  updateTaxSection: vi.fn(),
  deleteTaxSection: vi.fn(),
}));

import {
  createTaxSection,
  deleteTaxSection,
  listTaxSections,
  updateTaxSection,
} from '../repositories/tax-section';

interface HttpResponse {
  status: number;
  body: unknown;
}

let server: ReturnType<Express['listen']>;
let baseUrl: string;

const section: TaxSection = {
  code: 'St-WK',
  name: 'Werbungskosten',
  form: 'Anlage N',
  belongs: null,
  excludes: null,
  receipts: null,
  note: null,
};
const updateBody: TaxSectionUpdateRequest = {
  expected: section,
  next: { ...section, code: 'St-W2', name: 'Neu' },
};

async function send(method: string, path: string, body?: unknown): Promise<HttpResponse> {
  const response: Response = await fetch(`${baseUrl}${path}`, {
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

function dbError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app: Express = express();
      app.use(express.json());
      app.use('/tax-sections', createTaxSectionsRouter());
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

beforeEach(() => {
  vi.resetAllMocks();
});

describe('tax-sections router GET /', () => {
  it('returns the sections', async () => {
    vi.mocked(listTaxSections).mockResolvedValueOnce([section]);

    const response: HttpResponse = await send('GET', '/tax-sections');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([section]);
  });
});

describe('tax-sections router POST /', () => {
  it('returns 201 with the stored section', async () => {
    vi.mocked(createTaxSection).mockResolvedValueOnce(section);

    const response: HttpResponse = await send('POST', '/tax-sections', section);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(section);
  });

  it('trims the name', async () => {
    vi.mocked(createTaxSection).mockResolvedValueOnce(section);

    await send('POST', '/tax-sections', { ...section, name: '  Werbungskosten ' });

    expect(createTaxSection).toHaveBeenCalledWith(section);
  });

  it.each([
    ['St-0', { ...section, code: 'St-0' }],
    ['code with a space', { ...section, code: 'St X' }],
    ['code too long', { ...section, code: 'A'.repeat(17) }],
    ['empty code', { ...section, code: '' }],
    ['blank name', { ...section, name: '   ' }],
    ['overlong name', { ...section, name: 'x'.repeat(201) }],
    ['missing text field', { code: 'St-X', name: 'n' }],
    ['unknown key', { ...section, extra: 1 }],
  ])('returns 400 for %s', async (_label: string, body: unknown) => {
    const response: HttpResponse = await send('POST', '/tax-sections', body);

    expect(response.status).toBe(400);
    expect(createTaxSection).not.toHaveBeenCalled();
  });

  it('returns 409 duplicate for a taken code', async () => {
    vi.mocked(createTaxSection).mockRejectedValueOnce(dbError('ER_DUP_ENTRY'));

    const response: HttpResponse = await send('POST', '/tax-sections', section);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'duplicate' });
  });

  it('returns 500 for other errors', async () => {
    vi.mocked(createTaxSection).mockRejectedValueOnce(new Error('boom'));

    expect((await send('POST', '/tax-sections', section)).status).toBe(500);
  });
});

describe('tax-sections router PUT /:code', () => {
  it('returns 204 and passes expected and next on', async () => {
    vi.mocked(updateTaxSection).mockResolvedValueOnce('updated');

    const response: HttpResponse = await send('PUT', '/tax-sections/St-WK', updateBody);

    expect(response.status).toBe(204);
    expect(updateTaxSection).toHaveBeenCalledWith(updateBody.expected, updateBody.next);
  });

  it('returns 400 when :code differs from expected.code', async () => {
    expect((await send('PUT', '/tax-sections/St-V', updateBody)).status).toBe(400);
    expect(updateTaxSection).not.toHaveBeenCalled();
  });

  it('returns 400 for St-0 and for an invalid body', async () => {
    expect((await send('PUT', '/tax-sections/St-0', updateBody)).status).toBe(400);
    expect((await send('PUT', '/tax-sections/St-WK', { next: section })).status).toBe(400);
    expect(
      (
        await send('PUT', '/tax-sections/St-WK', {
          ...updateBody,
          next: { ...section, code: 'St-0' },
        })
      ).status,
    ).toBe(400);
    expect(updateTaxSection).not.toHaveBeenCalled();
  });

  it('returns 409 conflict when the section changed', async () => {
    vi.mocked(updateTaxSection).mockResolvedValueOnce('conflict');

    const response: HttpResponse = await send('PUT', '/tax-sections/St-WK', updateBody);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'conflict' });
  });

  it('returns 409 duplicate when the new code is taken', async () => {
    vi.mocked(updateTaxSection).mockRejectedValueOnce(dbError('ER_DUP_ENTRY'));

    const response: HttpResponse = await send('PUT', '/tax-sections/St-WK', updateBody);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'duplicate' });
  });
});

describe('tax-sections router DELETE /:code', () => {
  it('returns 204', async () => {
    vi.mocked(deleteTaxSection).mockResolvedValueOnce(true);

    expect((await send('DELETE', '/tax-sections/St-WK')).status).toBe(204);
    expect(deleteTaxSection).toHaveBeenCalledWith('St-WK');
  });

  it('returns 404 when missing', async () => {
    vi.mocked(deleteTaxSection).mockResolvedValueOnce(false);

    expect((await send('DELETE', '/tax-sections/St-WK')).status).toBe(404);
  });

  it('returns 409 in-use when a category still has the tag', async () => {
    vi.mocked(deleteTaxSection).mockRejectedValueOnce(dbError('ER_ROW_IS_REFERENCED_2'));

    const response: HttpResponse = await send('DELETE', '/tax-sections/St-WK');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'in-use' });
  });

  it('returns 400 for St-0', async () => {
    expect((await send('DELETE', '/tax-sections/St-0')).status).toBe(400);
    expect(deleteTaxSection).not.toHaveBeenCalled();
  });
});
