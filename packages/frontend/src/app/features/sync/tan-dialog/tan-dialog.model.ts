import type {
  OpenTanChallenge,
  SyncConnectionStatus,
  SyncRun,
  TanAnswerRequest,
  TanChallengeKind,
} from '@hibiscus-frontend/shared/contracts/sync';

/** Data passed to `Dialog.open`: the run whose challenge the dialog answers. */
export interface TanDialogData {
  readonly runId: number;
}

/** What the dialog shows, derived from the sync status. */
export type TanView =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'challenge';
      readonly connectionName: string;
      readonly challenge: OpenTanChallenge;
    }
  | { readonly kind: 'failed'; readonly connectionName: string; readonly run: SyncRun }
  /** The challenge is gone and the run did not fail: answered, or no longer waiting. */
  | { readonly kind: 'done' };

/**
 * The state of run `runId` in `statuses`: its open challenge, a failure to report (`error` or
 * `tan_expired`), or done once the challenge disappeared.
 */
export function tanViewOf(
  statuses: readonly SyncConnectionStatus[] | null,
  runId: number,
): TanView {
  if (statuses === null) return { kind: 'loading' };
  for (const status of statuses) {
    if (status.challenge?.runId === runId) {
      return { kind: 'challenge', connectionName: status.name, challenge: status.challenge };
    }
  }
  for (const status of statuses) {
    const run: SyncRun | null = status.latestRun;
    if (run && run.id === runId && (run.status === 'error' || run.status === 'tan_expired')) {
      return { kind: 'failed', connectionName: status.name, run };
    }
  }
  return { kind: 'done' };
}

/**
 * The request body for answering a challenge of `kind` with the typed `input`: a TAN for `tan` and
 * `phototan` (`null` while empty), nothing for `decoupled`, which only acknowledges.
 */
export function tanAnswerOf(kind: TanChallengeKind, input: string): TanAnswerRequest | null {
  if (kind === 'decoupled') return {};
  const tan: string = input.trim();
  return tan === '' ? null : { tan };
}

/** URL of a `phototan` challenge's image. */
export function challengeImageUrl(runId: number): string {
  return `/api/sync/runs/${runId}/challenge-image`;
}
