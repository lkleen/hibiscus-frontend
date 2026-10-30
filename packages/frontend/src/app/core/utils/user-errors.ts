import { HttpErrorResponse } from '@angular/common/http';
import type { UserDatabaseTestResponse, UserError } from '@hibiscus-frontend/shared/contracts/user';

const USER_ERRORS: readonly UserError['error'][] = [
  'database-not-configured',
  'host-not-allowed',
  'busy',
  'database-in-use',
  'key-not-configured',
  'key-configured',
  'key-required',
  'key-invalid',
];

/**
 * The `UserError.error` an HTTP failure carried, or `null` for any other failure (network, 5xx,
 * a body without a known error code).
 */
export function userErrorOf(failure: unknown): UserError['error'] | null {
  if (!(failure instanceof HttpErrorResponse)) return null;
  const body: unknown = failure.error;
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const code: unknown = body.error;
  return USER_ERRORS.find((known: UserError['error']) => known === code) ?? null;
}

/**
 * The connection test result a failed `PUT /api/user/database` carried (`400` with a
 * `UserDatabaseTestResponse`), or `null` for any other failure.
 */
export function testResultOf(failure: unknown): UserDatabaseTestResponse | null {
  if (!(failure instanceof HttpErrorResponse) || failure.status !== 400) return null;
  const body: unknown = failure.error;
  if (
    typeof body !== 'object' ||
    body === null ||
    !('ok' in body) ||
    !('hibiscusSchema' in body) ||
    !('error' in body)
  ) {
    return null;
  }
  if (typeof body.ok !== 'boolean' || typeof body.hibiscusSchema !== 'boolean') return null;
  if (body.error !== null && typeof body.error !== 'string') return null;
  return { ok: body.ok, hibiscusSchema: body.hibiscusSchema, error: body.error };
}
