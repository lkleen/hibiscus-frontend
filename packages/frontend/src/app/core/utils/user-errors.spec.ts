import { HttpErrorResponse } from '@angular/common/http';
import { testResultOf, userErrorOf } from './user-errors';

function failure(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error });
}

describe('userErrorOf', () => {
  it('reads a known error code', () => {
    expect(userErrorOf(failure(400, { error: 'key-invalid' }))).toBe('key-invalid');
    expect(userErrorOf(failure(409, { error: 'database-not-configured' }))).toBe(
      'database-not-configured',
    );
  });

  it('ignores unknown codes and other failures', () => {
    expect(userErrorOf(failure(400, { error: 'locked' }))).toBeNull();
    expect(userErrorOf(failure(500, 'boom'))).toBeNull();
    expect(userErrorOf(new Error('x'))).toBeNull();
  });
});

describe('testResultOf', () => {
  it('reads the test result of a 400', () => {
    expect(
      testResultOf(failure(400, { ok: false, hibiscusSchema: false, error: 'refused' })),
    ).toEqual({ ok: false, hibiscusSchema: false, error: 'refused' });
  });

  it('is null for error codes and other statuses', () => {
    expect(testResultOf(failure(400, { error: 'host-not-allowed' }))).toBeNull();
    expect(
      testResultOf(failure(500, { ok: false, hibiscusSchema: false, error: null })),
    ).toBeNull();
  });
});
