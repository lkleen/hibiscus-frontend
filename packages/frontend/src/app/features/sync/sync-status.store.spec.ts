import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SyncConnectionStatus, SyncRun } from '@hibiscus-frontend/shared/contracts/sync';
import {
  SYNC_POLL_BUSY_MS,
  SYNC_POLL_IDLE_MS,
  SyncStatusStore,
  finishedRun,
} from './sync-status.store';

function run(id: number, status: SyncRun['status']): SyncRun {
  return {
    id,
    trigger: 'manual',
    startedAt: '2026-10-29 10:00:00',
    finishedAt: null,
    status,
    error: null,
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

describe('SyncStatusStore', () => {
  let httpMock: HttpTestingController;
  let store: SyncStatusStore;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SyncStatusStore);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives busy, challenges and paused connections from the status', () => {
    store.refresh().subscribe();
    httpMock.expectOne('/api/sync/status').flush([
      status({
        id: 1,
        latestRun: run(5, 'tan_required'),
        challenge: { runId: 5, kind: 'tan', message: 'TAN?', hasImage: false },
      }),
      status({ id: 2, name: 'Consors', pausedReason: 'tan', latestRun: run(6, 'tan_expired') }),
    ]);

    expect(store.busy()).toBe(true);
    expect(store.challenges().map((c) => c.connectionId)).toEqual([1]);
    expect(store.pausedConnections().map((c) => c.id)).toEqual([2]);
  });

  it('polls every 5 s while a run is active and every 60 s otherwise', () => {
    store.startPolling();
    httpMock.expectOne('/api/sync/status').flush([status({ latestRun: run(5, 'running') })]);

    vi.advanceTimersByTime(SYNC_POLL_BUSY_MS - 1);
    httpMock.expectNone('/api/sync/status');
    vi.advanceTimersByTime(1);
    httpMock.expectOne('/api/sync/status').flush([status({ latestRun: run(5, 'success') })]);

    vi.advanceTimersByTime(SYNC_POLL_BUSY_MS);
    httpMock.expectNone('/api/sync/status');
    vi.advanceTimersByTime(SYNC_POLL_IDLE_MS - SYNC_POLL_BUSY_MS);
    httpMock.expectOne('/api/sync/status').flush([]);

    store.stopPolling();
    vi.advanceTimersByTime(SYNC_POLL_IDLE_MS);
    httpMock.expectNone('/api/sync/status');
  });

  it('keeps polling after a failed poll and flags the error', () => {
    store.startPolling();
    httpMock.expectOne('/api/sync/status').flush('x', { status: 500, statusText: 'Server Error' });
    expect(store.error()).toBe(true);

    vi.advanceTimersByTime(SYNC_POLL_IDLE_MS);
    httpMock.expectOne('/api/sync/status').flush([]);
    expect(store.error()).toBe(false);
    store.stopPolling();
  });

  it('never lets an older answer overwrite a newer one', () => {
    store.refresh().subscribe();
    store.refresh().subscribe();
    const [older, newer] = httpMock.match('/api/sync/status');
    newer!.flush([status({ name: 'new' })]);
    older!.flush([status({ name: 'old' })]);

    expect(store.statuses()?.[0]?.name).toBe('new');
  });

  it('throws on stopPolling without startPolling', () => {
    expect(() => store.stopPolling()).toThrow();
  });
});

describe('finishedRun', () => {
  it('returns the run only once it finished', () => {
    expect(finishedRun([status({ latestRun: run(5, 'tan_required') })], 1, 5)).toBeNull();
    expect(finishedRun([status({ latestRun: run(5, 'success') })], 1, 5)?.id).toBe(5);
    expect(finishedRun([status({ latestRun: run(6, 'success') })], 1, 5)).toBeNull();
    expect(finishedRun([status({ id: 2, latestRun: run(5, 'success') })], 1, 5)).toBeNull();
  });
});
