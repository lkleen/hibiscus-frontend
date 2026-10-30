import type { SyncConnectionStatus, SyncRun } from '@hibiscus-frontend/shared/contracts/sync';
import { tanAnswerOf, tanViewOf } from './tan-dialog.model';

function run(id: number, status: SyncRun['status']): SyncRun {
  return {
    id,
    trigger: 'manual',
    startedAt: '2026-10-29 10:00:00',
    finishedAt: null,
    status,
    error: status === 'error' ? 'boom' : null,
    inserted: 0,
    deleted: 0,
  };
}

function status(over: Partial<SyncConnectionStatus>): SyncConnectionStatus {
  return {
    id: 1,
    name: 'Comdirect',
    enabled: true,
    pausedReason: null,
    lastSyncAt: null,
    lastStatus: null,
    lastError: null,
    latestRun: null,
    challenge: null,
    ...over,
  };
}

describe('tanViewOf', () => {
  it('is loading before the first status', () => {
    expect(tanViewOf(null, 7).kind).toBe('loading');
  });

  it('shows the open challenge of the run', () => {
    const view = tanViewOf(
      [status({ challenge: { runId: 7, kind: 'tan', message: 'Enter', hasImage: false } })],
      7,
    );
    expect(view.kind).toBe('challenge');
  });

  it('ignores the challenge of another run', () => {
    const view = tanViewOf(
      [status({ challenge: { runId: 8, kind: 'tan', message: 'Enter', hasImage: false } })],
      7,
    );
    expect(view.kind).toBe('done');
  });

  it('reports a run that ended in error or tan_expired', () => {
    expect(tanViewOf([status({ latestRun: run(7, 'error') })], 7).kind).toBe('failed');
    expect(tanViewOf([status({ latestRun: run(7, 'tan_expired') })], 7).kind).toBe('failed');
  });

  it('is done once the run succeeded or continues without a challenge', () => {
    expect(tanViewOf([status({ latestRun: run(7, 'success') })], 7).kind).toBe('done');
    expect(tanViewOf([status({ latestRun: run(7, 'running') })], 7).kind).toBe('done');
  });
});

describe('tanAnswerOf', () => {
  it('requires a TAN for tan and phototan', () => {
    expect(tanAnswerOf('tan', '  ')).toBeNull();
    expect(tanAnswerOf('phototan', '')).toBeNull();
    expect(tanAnswerOf('tan', ' 123456 ')).toEqual({ tan: '123456' });
  });

  it('sends no TAN for decoupled', () => {
    expect(tanAnswerOf('decoupled', 'ignored')).toEqual({});
  });
});
