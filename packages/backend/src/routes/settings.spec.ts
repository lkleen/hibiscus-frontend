import express, { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatePresetList, TaxProfile } from '@hibiscus-frontend/shared/contracts/user-settings';
import { DEFAULT_DATE_PRESETS } from '../settings/date-presets';
import { DEFAULT_TABLE_DENSITIES } from '../settings/table-density';
import { DEFAULT_TAX_PROFILE } from '../settings/tax-profile';
import { createSettingsRouter } from './settings';

vi.mock('../repositories/user-setting', () => ({
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
  deleteUserSetting: vi.fn(),
}));

import { deleteUserSetting, getUserSetting, putUserSetting } from '../repositories/user-setting';

interface FetchResponse {
  status: number;
  body: unknown;
}

interface FetchSettingsParams {
  path: string;
  method: string;
  body?: unknown;
  user?: string;
}

let app: Express;
let server: ReturnType<typeof app.listen>;
let baseUrl: string;

async function fetchSettings(params: FetchSettingsParams): Promise<FetchResponse> {
  const { path, method, body, user = 'alice' } = params;
  const headers: Record<string, string> = {
    'x-test-user': user,
    'content-type': 'application/json',
  };

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let responseBody: unknown;
  const contentType: string | null = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    responseBody = await response.json();
  } else {
    responseBody = null;
  }

  return {
    status: response.status,
    body: responseBody,
  };
}

describe('settings router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        // Create Express app once for all tests
        app = express();
        // Same JSON options as server.ts.
        app.use(express.json({ strict: false }));

        // Auth middleware that sets user from x-test-user header
        app.use((_req, res, next) => {
          res.locals['user'] = (_req.headers['x-test-user'] as string) ?? 'alice';
          next();
        });

        app.use('/settings', createSettingsRouter());

        /* eslint-disable @typescript-eslint/no-unused-vars,@typescript-eslint/max-params */
        const errorHandler = (
          err: Error,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ): void => {
          res.status(500).json({ error: err.message });
        };
        /* eslint-enable @typescript-eslint/no-unused-vars,@typescript-eslint/max-params */
        app.use(errorHandler);

        // Start server on port 0 (random available port)
        server = app.listen(0, () => {
          const addr = server.address();
          if (addr && typeof addr === 'object' && 'port' in addr) {
            baseUrl = `http://127.0.0.1:${addr.port}`;
          }
          resolve();
        });
      }),
  );

  afterAll(() => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  describe('GET /settings/date-presets', () => {
    it('returns DEFAULT_DATE_PRESETS when no stored row exists', async () => {
      vi.mocked(getUserSetting).mockResolvedValueOnce(undefined);

      const response = await fetchSettings({ path: '/settings/date-presets', method: 'GET' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(DEFAULT_DATE_PRESETS);
      expect(getUserSetting).toHaveBeenCalledWith('alice', 'date-presets');
      expect(getUserSetting).toHaveBeenCalledTimes(1);
    });

    it('returns the stored valid date preset list', async () => {
      const storedPresets: DatePresetList = [
        {
          id: 'custom-1',
          kind: 'fixed',
          name: 'Last Quarter',
          from: '2026-01-01',
          to: '2026-03-31',
        },
      ];
      vi.mocked(getUserSetting).mockResolvedValueOnce(storedPresets);

      const response = await fetchSettings({ path: '/settings/date-presets', method: 'GET' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(storedPresets);
      expect(getUserSetting).toHaveBeenCalledWith('alice', 'date-presets');
    });

    it('returns 500 when stored value is corrupt (fails schema validation)', async () => {
      vi.mocked(getUserSetting).mockResolvedValueOnce([{ id: 'x' }]);

      const response = await fetchSettings({ path: '/settings/date-presets', method: 'GET' });

      expect(response.status).toBe(500);
      expect(typeof response.body).toBe('object');
      expect(response.body).not.toBeNull();
    });

    it('scopes getUserSetting to the requesting user', async () => {
      vi.mocked(getUserSetting).mockResolvedValueOnce(undefined);

      await fetchSettings({
        path: '/settings/date-presets',
        method: 'GET',
        body: undefined,
        user: 'bob',
      });

      expect(getUserSetting).toHaveBeenCalledWith('bob', 'date-presets');
    });
  });

  describe('PUT /settings/date-presets', () => {
    it('saves a valid list with one relative and one fixed preset', async () => {
      const presets: DatePresetList = [
        {
          id: 'current-month',
          kind: 'relative',
          unit: 'month',
          offset: 0,
          count: 1,
          name: null,
        },
        {
          id: 'last-year',
          kind: 'fixed',
          name: 'Last Year',
          from: '2025-01-01',
          to: '2025-12-31',
        },
      ];
      vi.mocked(putUserSetting).mockResolvedValueOnce(undefined);

      const response = await fetchSettings({
        path: '/settings/date-presets',
        method: 'PUT',
        body: presets,
      });

      expect(response.status).toBe(204);
      expect(putUserSetting).toHaveBeenCalledWith({
        user: 'alice',
        key: 'date-presets',
        value: presets,
      });
      expect(putUserSetting).toHaveBeenCalledTimes(1);
    });

    it('rejects impossible date (2026-02-30)', async () => {
      const presets: unknown = [
        {
          id: 'invalid-date',
          kind: 'fixed',
          name: 'Invalid',
          from: '2026-02-30',
          to: '2026-03-31',
        },
      ];

      const response = await fetchSettings({
        path: '/settings/date-presets',
        method: 'PUT',
        body: presets,
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects when from is after to', async () => {
      const presets: unknown = [
        {
          id: 'backwards',
          kind: 'fixed',
          name: 'Backwards',
          from: '2026-12-31',
          to: '2026-01-01',
        },
      ];

      const response = await fetchSettings({
        path: '/settings/date-presets',
        method: 'PUT',
        body: presets,
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects duplicate ids', async () => {
      const presets: unknown = [
        {
          id: 'same-id',
          kind: 'relative',
          unit: 'month',
          offset: 0,
          count: 1,
          name: null,
        },
        {
          id: 'same-id',
          kind: 'relative',
          unit: 'year',
          offset: 0,
          count: 1,
          name: null,
        },
      ];

      const response = await fetchSettings({
        path: '/settings/date-presets',
        method: 'PUT',
        body: presets,
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects offset = 1 (must be <= 0)', async () => {
      const presets: unknown = [
        {
          id: 'positive-offset',
          kind: 'relative',
          unit: 'month',
          offset: 1,
          count: 1,
          name: null,
        },
      ];

      const response = await fetchSettings({
        path: '/settings/date-presets',
        method: 'PUT',
        body: presets,
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects count = 0 (must be >= 1)', async () => {
      const presets: unknown = [
        {
          id: 'zero-count',
          kind: 'relative',
          unit: 'month',
          offset: 0,
          count: 0,
          name: null,
        },
      ];

      const response = await fetchSettings({
        path: '/settings/date-presets',
        method: 'PUT',
        body: presets,
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects more than 50 presets', async () => {
      const presets: unknown = Array.from({ length: 51 }, (_, i) => ({
        id: `preset-${i}`,
        kind: 'relative',
        unit: 'month',
        offset: 0,
        count: 1,
        name: null,
      }));

      const response = await fetchSettings({
        path: '/settings/date-presets',
        method: 'PUT',
        body: presets,
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects name that is empty after trim', async () => {
      const presets: unknown = [
        {
          id: 'empty-name',
          kind: 'relative',
          unit: 'month',
          offset: 0,
          count: 1,
          name: '   ',
        },
      ];

      const response = await fetchSettings({
        path: '/settings/date-presets',
        method: 'PUT',
        body: presets,
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('scopes putUserSetting to the requesting user', async () => {
      const presets: DatePresetList = [
        {
          id: 'test',
          kind: 'relative',
          unit: 'month',
          offset: 0,
          count: 1,
          name: null,
        },
      ];
      vi.mocked(putUserSetting).mockResolvedValueOnce(undefined);

      await fetchSettings({
        path: '/settings/date-presets',
        method: 'PUT',
        body: presets,
        user: 'bob',
      });

      expect(putUserSetting).toHaveBeenCalledWith({
        user: 'bob',
        key: 'date-presets',
        value: presets,
      });
    });
  });

  describe('GET /settings/table-densities', () => {
    it('returns the default empty map when no stored row exists', async () => {
      vi.mocked(getUserSetting).mockResolvedValueOnce(undefined);

      const response = await fetchSettings({ path: '/settings/table-densities', method: 'GET' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(DEFAULT_TABLE_DENSITIES);
      expect(getUserSetting).toHaveBeenCalledWith('alice', 'table-densities');
    });

    it('returns the stored valid density map', async () => {
      const stored: Record<string, string> = {
        'transactions-list': 'spacious',
        categories: 'compact',
      };
      vi.mocked(getUserSetting).mockResolvedValueOnce(stored);

      const response = await fetchSettings({ path: '/settings/table-densities', method: 'GET' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(stored);
    });

    it('returns 500 when the stored value is corrupt (unknown density)', async () => {
      vi.mocked(getUserSetting).mockResolvedValueOnce({ 'transactions-list': 'huge' });

      const response = await fetchSettings({ path: '/settings/table-densities', method: 'GET' });

      expect(response.status).toBe(500);
    });

    it('returns 500 when the stored value has an unknown view key', async () => {
      vi.mocked(getUserSetting).mockResolvedValueOnce({ 'no-such-view': 'compact' });

      const response = await fetchSettings({ path: '/settings/table-densities', method: 'GET' });

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /settings/table-densities', () => {
    it('saves a valid density map and returns 204', async () => {
      vi.mocked(putUserSetting).mockResolvedValueOnce(undefined);
      const densities: Record<string, string> = {
        'transactions-list': 'compact',
        'transactions-by-category': 'comfortable',
      };

      const response = await fetchSettings({
        path: '/settings/table-densities',
        method: 'PUT',
        body: densities,
      });

      expect(response.status).toBe(204);
      expect(putUserSetting).toHaveBeenCalledWith({
        user: 'alice',
        key: 'table-densities',
        value: densities,
      });
    });

    it('saves an empty map and returns 204', async () => {
      vi.mocked(putUserSetting).mockResolvedValueOnce(undefined);

      const response = await fetchSettings({
        path: '/settings/table-densities',
        method: 'PUT',
        body: {},
      });

      expect(response.status).toBe(204);
      expect(putUserSetting).toHaveBeenCalledWith({
        user: 'alice',
        key: 'table-densities',
        value: {},
      });
    });

    it('rejects an unknown density with 400', async () => {
      const response = await fetchSettings({
        path: '/settings/table-densities',
        method: 'PUT',
        body: { categories: 'huge' },
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects an unknown view key with 400', async () => {
      const response = await fetchSettings({
        path: '/settings/table-densities',
        method: 'PUT',
        body: { 'no-such-view': 'compact' },
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects a bare string body with 400', async () => {
      const response = await fetchSettings({
        path: '/settings/table-densities',
        method: 'PUT',
        body: 'compact',
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });
  });

  describe('GET /settings/tax-profile', () => {
    it('returns the default profile when no stored row exists', async () => {
      vi.mocked(getUserSetting).mockResolvedValueOnce(undefined);

      const response = await fetchSettings({ path: '/settings/tax-profile', method: 'GET' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(DEFAULT_TAX_PROFILE);
      expect(getUserSetting).toHaveBeenCalledWith('alice', 'tax-profile');
    });

    it('returns the stored valid profile', async () => {
      const stored: TaxProfile = {
        ...DEFAULT_TAX_PROFILE,
        situations: { ...DEFAULT_TAX_PROFILE.situations, employed: true, rental: false },
        hintDismissedYear: 2025,
      };
      vi.mocked(getUserSetting).mockResolvedValueOnce(stored);

      const response = await fetchSettings({ path: '/settings/tax-profile', method: 'GET' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(stored);
    });

    it('returns 500 when the stored value is corrupt', async () => {
      vi.mocked(getUserSetting).mockResolvedValueOnce({ situations: {}, hintDismissedYear: 1 });

      const response = await fetchSettings({ path: '/settings/tax-profile', method: 'GET' });

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /settings/tax-profile', () => {
    it('saves a valid profile and returns 204', async () => {
      vi.mocked(putUserSetting).mockResolvedValueOnce(undefined);
      const profile: TaxProfile = {
        ...DEFAULT_TAX_PROFILE,
        situations: { ...DEFAULT_TAX_PROFILE.situations, children: true },
        hintDismissedYear: 2025,
      };

      const response = await fetchSettings({
        path: '/settings/tax-profile',
        method: 'PUT',
        body: profile,
      });

      expect(response.status).toBe(204);
      expect(putUserSetting).toHaveBeenCalledWith({
        user: 'alice',
        key: 'tax-profile',
        value: profile,
      });
    });

    it('rejects a missing situation with 400', async () => {
      const response = await fetchSettings({
        path: '/settings/tax-profile',
        method: 'PUT',
        body: { situations: { employed: true }, hintDismissedYear: null },
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects an unknown situation with 400', async () => {
      const response = await fetchSettings({
        path: '/settings/tax-profile',
        method: 'PUT',
        body: {
          ...DEFAULT_TAX_PROFILE,
          situations: { ...DEFAULT_TAX_PROFILE.situations, pets: true },
        },
      });

      expect(response.status).toBe(400);
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range or fractional year with 400', async () => {
      for (const year of [1899, 10000, 2025.5]) {
        const response = await fetchSettings({
          path: '/settings/tax-profile',
          method: 'PUT',
          body: { ...DEFAULT_TAX_PROFILE, hintDismissedYear: year },
        });
        expect(response.status).toBe(400);
      }
      expect(putUserSetting).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /settings/date-presets', () => {
    it('deletes the user setting and returns 204', async () => {
      vi.mocked(deleteUserSetting).mockResolvedValueOnce(undefined);

      const response = await fetchSettings({ path: '/settings/date-presets', method: 'DELETE' });

      expect(response.status).toBe(204);
      expect(deleteUserSetting).toHaveBeenCalledWith('alice', 'date-presets');
      expect(deleteUserSetting).toHaveBeenCalledTimes(1);
    });

    it('scopes deleteUserSetting to the requesting user', async () => {
      vi.mocked(deleteUserSetting).mockResolvedValueOnce(undefined);

      await fetchSettings({
        path: '/settings/date-presets',
        method: 'DELETE',
        body: undefined,
        user: 'bob',
      });

      expect(deleteUserSetting).toHaveBeenCalledWith('bob', 'date-presets');
    });
  });
});
