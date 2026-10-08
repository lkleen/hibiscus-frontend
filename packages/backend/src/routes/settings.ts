import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  DEFAULT_DATE_PRESETS,
  DATE_PRESETS_SETTING_KEY,
  DatePresetListSchema,
} from '../settings/date-presets';
import {
  DEFAULT_TABLE_DENSITY,
  TABLE_DENSITY_SETTING_KEY,
  TableDensitySchema,
} from '../settings/table-density';
import { deleteUserSetting, getUserSetting, putUserSetting } from '../repositories/user-setting';
import { respondWithValidationError } from './zod-validation';

export function createSettingsRouter(): Router {
  const router = Router();

  /**
   * GET /date-presets: retrieve the user's date presets, or the defaults if not yet customized.
   * A stored value is re-validated against the schema; a corrupt row throws a 500.
   */
  router.get('/date-presets', (_req: Request, res: Response, next: NextFunction): void => {
    const user = res.locals['user'] as string;
    getUserSetting(user, DATE_PRESETS_SETTING_KEY)
      .then((value: unknown | undefined) => {
        const presets: unknown = value === undefined ? DEFAULT_DATE_PRESETS : value;
        // Re-validate the stored value. A corrupt row is a fatal error, not a fallback.
        const parseResult = DatePresetListSchema.safeParse(presets);
        if (!parseResult.success) {
          next(new Error(`Stored date presets are invalid: ${parseResult.error.message}`));
          return;
        }
        res.json(parseResult.data);
      })
      .catch(next);
  });

  /**
   * PUT /date-presets: save the user's date presets. Validates the whole list, then saves atomically.
   */
  router.put('/date-presets', (req: Request, res: Response, next: NextFunction): void => {
    const user = res.locals['user'] as string;
    const parseResult = DatePresetListSchema.safeParse(req.body);
    if (!parseResult.success) {
      respondWithValidationError(res, parseResult.error);
      return;
    }

    putUserSetting({
      user,
      key: DATE_PRESETS_SETTING_KEY,
      value: parseResult.data,
    })
      .then(() => res.status(204).send())
      .catch(next);
  });

  /**
   * DELETE /date-presets: restore the default presets for this user.
   */
  router.delete('/date-presets', (_req: Request, res: Response, next: NextFunction): void => {
    const user = res.locals['user'] as string;
    deleteUserSetting(user, DATE_PRESETS_SETTING_KEY)
      .then(() => res.status(204).send())
      .catch(next);
  });

  /**
   * GET /table-density: retrieve the user's table density, or the default if not yet chosen.
   * A stored value is re-validated against the schema; a corrupt row throws a 500.
   */
  router.get('/table-density', (_req: Request, res: Response, next: NextFunction): void => {
    const user = res.locals['user'] as string;
    getUserSetting(user, TABLE_DENSITY_SETTING_KEY)
      .then((value: unknown | undefined) => {
        const density: unknown = value === undefined ? DEFAULT_TABLE_DENSITY : value;
        const parseResult = TableDensitySchema.safeParse(density);
        if (!parseResult.success) {
          next(new Error(`Stored table density is invalid: ${parseResult.error.message}`));
          return;
        }
        res.json(parseResult.data);
      })
      .catch(next);
  });

  /**
   * PUT /table-density: save the user's table density (body is a bare JSON string).
   */
  router.put('/table-density', (req: Request, res: Response, next: NextFunction): void => {
    const user = res.locals['user'] as string;
    const parseResult = TableDensitySchema.safeParse(req.body);
    if (!parseResult.success) {
      respondWithValidationError(res, parseResult.error);
      return;
    }

    putUserSetting({
      user,
      key: TABLE_DENSITY_SETTING_KEY,
      value: parseResult.data,
    })
      .then(() => res.status(204).send())
      .catch(next);
  });

  return router;
}
