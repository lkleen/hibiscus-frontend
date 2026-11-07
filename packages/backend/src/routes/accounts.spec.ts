import express, { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { AccountRepository } from '../repositories/konto';
import { createAccountsRouter } from './accounts';

const listAccounts = vi.fn<AccountRepository['list']>();
const accounts: AccountRepository = { list: listAccounts };

let server: ReturnType<Express['listen']>;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app: Express = express();
      app.use('/accounts', createAccountsRouter({ accounts }));
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

describe('accounts router GET /', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with the accounts', async () => {
    const rows: AccountRow[] = [{ id: 1, bezeichnung: 'Giro' } as AccountRow];
    listAccounts.mockResolvedValueOnce(rows);

    const response: Response = await fetch(`${baseUrl}/accounts`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rows);
  });

  it('returns 500 when the repository fails', async () => {
    listAccounts.mockRejectedValueOnce(new Error('boom'));

    expect((await fetch(`${baseUrl}/accounts`)).status).toBe(500);
  });
});
