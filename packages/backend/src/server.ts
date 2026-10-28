import compression from 'compression';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config/config';
import { initPool } from './db/pool';
import { createAuthMiddleware } from './middleware/auth';
import { createAccountsRouter } from './routes/accounts';
import { createCategoriesRouter } from './routes/categories';
import { createMeRouter } from './routes/me';
import { createSettingsRouter } from './routes/settings';
import { createTaxSectionsRouter } from './routes/tax-sections';
import { createTaxTagsRouter } from './routes/tax-tags';
import { createTransactionsRouter } from './routes/transactions';
import { ensureTaxTagTables } from './repositories/tax-tag';
import { ensureUserSettingTable } from './repositories/user-setting';

async function main(): Promise<void> {
  const config = loadConfig();
  initPool(config);
  await ensureUserSettingTable();
  await ensureTaxTagTables();

  const app = express();

  // The proxy in front of this app is the real access control, not CORS — see
  // docs/architecture.md#authentication. Allowing all origins here is fine.
  // gzip every response the client accepts it for — mostly for `GET /api/transactions`, which
  // is several MB of JSON uncompressed. Registered first so it wraps every route below.
  app.use(compression());
  app.use(cors());
  // `limit`: the default 100kb would reject `POST /api/transactions/assign-category` well below
  // its 10,000-row cap (each row carries its expected comment); 10mb covers that with ordinary
  // comments.
  app.use(express.json({ limit: '10mb' }));

  const requireAuth = createAuthMiddleware(config);

  // Every /api/* route — including /api/me — sits behind the forward-auth gate. There is no
  // unauthenticated route in this app.
  const api = express.Router();
  api.use(requireAuth);
  api.use('/me', createMeRouter());
  api.use('/accounts', createAccountsRouter());
  api.use('/transactions', createTransactionsRouter());
  api.use('/categories', createCategoriesRouter());
  api.use('/settings', createSettingsRouter());
  api.use('/tax-sections', createTaxSectionsRouter());
  api.use('/tax-tags', createTaxTagsRouter());
  app.use('/api', api);

  // A path under /api that didn't match any route above is a real 404 — it must not fall
  // through to the SPA catch-all below, which would wrongly return index.html for it.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Serve the built frontend. Only present in the production Docker image (the Dockerfile
  // copies packages/frontend's `dist/frontend/browser` to `./public` next to this compiled
  // `dist/server.js`); absent in local dev, where the Angular dev server serves the frontend
  // instead — this block is then simply a no-op.
  const publicDir = join(__dirname, '..', 'public');
  if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(join(publicDir, 'index.html'));
    });
  }

  // Single top-level error handler: every route hands unexpected errors to `next(err)` (via
  // `.catch(next)` on its repository call) instead of handling them mid-stack, and they all
  // land here. Express only recognizes an error-handling middleware by its arity — it must
  // declare exactly 4 parameters, even though the last one is never called — so both rules
  // below are disabled for this one declaration rather than worked around.
  // eslint-disable-next-line @typescript-eslint/max-params, @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    console.error('[hibiscus-backend] Unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  app.listen(config.PORT, () => {
    console.log(`[hibiscus-backend] Listening on port ${config.PORT}`);
  });
}

main().catch((err: unknown) => {
  console.error('[hibiscus-backend] Fatal startup error:', err);
  process.exit(1);
});
