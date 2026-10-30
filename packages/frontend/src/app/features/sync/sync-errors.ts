import { HttpErrorResponse } from '@angular/common/http';
import type { SyncError } from '@hibiscus-frontend/shared/contracts/sync';

/**
 * The `SyncError.error` an HTTP failure carried, or `null` for any other failure (network, 5xx,
 * a body without a known error code).
 */
export function syncErrorOf(failure: unknown): SyncError['error'] | null {
  if (!(failure instanceof HttpErrorResponse)) return null;
  const body: unknown = failure.error;
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const code: unknown = body.error;
  return code === 'not-found' || code === 'conflict' || code === 'locked' || code === 'no-challenge'
    ? code
    : null;
}
