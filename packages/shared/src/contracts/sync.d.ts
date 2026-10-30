/**
 * Bank sync: the FinTS bank connections the backend fetches statements and balances for, the runs
 * it records, and the TAN challenges a run can wait on. Stored in the app-owned tables
 * `hf_bank_connection`, `hf_bank_connection_account` and `hf_sync_run`.
 *
 * The PIN is write-only: it is sent when a connection is created or its PIN replaced, stored
 * encrypted, and never returned by any route.
 *
 * Timestamps are `YYYY-MM-DD HH:mm:ss` in the server's time zone (the DB pool returns dates as
 * strings).
 *
 * Declared here once and imported by both packages; never re-declare it on either side.
 */

import type { UserKeyStatus } from './user';

/** What started a run: the 60-second scheduler, "Sync now", or an account discovery. */
export type SyncTrigger = 'scheduled' | 'manual' | 'discover';

/**
 * State of a run. `tan_required`: waiting for a TAN or an approval in the banking app.
 * `tan_expired`: nobody answered within 15 minutes.
 */
export type SyncRunStatus = 'running' | 'tan_required' | 'success' | 'error' | 'tan_expired';

/**
 * Why the scheduler skips a connection. `tan`: a scheduled run's TAN expired, so the scheduler
 * stops sending TAN requests until a manual "Sync now" clears the pause.
 */
export type SyncPausedReason = 'tan';

/** The user-editable fields of a bank connection (everything except the PIN). */
export interface BankConnectionSettings {
  readonly name: string;
  /** Bankleitzahl, 8 digits. */
  readonly blz: string;
  /** The bank's FinTS endpoint, `https://…`. */
  readonly fintsUrl: string;
  readonly loginName: string;
  /** Only when the bank's customer ID differs from the login name. */
  readonly customerId: string | null;
  /** The chosen TAN method's id from `DiscoverDone.tanMethods`; `null` until one is chosen. */
  readonly tanMethod: number | null;
  /** The TAN medium's name, when the chosen method needs one (`TanMethodOption.mediaRequired`). */
  readonly tanMedia: string | null;
  /** Hours between two scheduled runs, 1–168. */
  readonly syncIntervalHours: number;
  /** Whether the scheduler syncs this connection. "Sync now" works either way. */
  readonly enabled: boolean;
}

/** One FinTS account mapped to a Hibiscus `konto`; only mapped accounts are synced. */
export interface BankConnectionAccount {
  /** The account's IBAN, or its account number when the bank reports no IBAN. */
  readonly accountIdentifier: string;
  /** `konto.id` the account's bookings and balance are written to. */
  readonly kontoId: number;
  /** Disabled mappings are kept but skipped by every run. */
  readonly enabled: boolean;
}

/** One element of `GET /api/bank-connections` (ordered by name), and the `201` body of `POST`. */
export interface BankConnection extends BankConnectionSettings {
  readonly id: number;
  readonly accounts: readonly BankConnectionAccount[];
  readonly pausedReason: SyncPausedReason | null;
  /** When the last run finished, whatever its outcome; `null` = never synced. */
  readonly lastSyncAt: string | null;
  readonly lastStatus: SyncRunStatus | null;
  readonly lastError: string | null;
}

/**
 * The user's key, for actions that encrypt or decrypt a PIN: required (`key-required`) in `manual`
 * mode and in `memory` mode while locked; ignored otherwise. `keepUnlocked` (`memory` only): keep
 * the key in server memory afterwards, as `POST /api/user/key/unlock` would.
 */
export interface WithUserKey {
  readonly key?: string;
  readonly keepUnlocked?: boolean;
}

/** Body of `POST /api/bank-connections`. */
export interface BankConnectionCreateRequest extends BankConnectionSettings, WithUserKey {
  readonly pin: string;
}

/**
 * Body of `PUT /api/bank-connections/:id`. `expected`: the settings the edit started from; a
 * connection that no longer holds them answers `409` `conflict`. `pin`: only when it is replaced,
 * omitted keeps the stored one. `204` on success. Changing `blz`, `fintsUrl`, `loginName` or
 * `customerId` drops the stored bank parameter data, so the next discovery starts fresh.
 */
export interface BankConnectionUpdateRequest extends WithUserKey {
  readonly expected: BankConnectionSettings;
  readonly next: BankConnectionSettings;
  readonly pin?: string;
}

/** Body of `PUT /api/bank-connections/:id/accounts`: the complete new mapping. `204`. */
export interface BankConnectionAccountsRequest {
  readonly accounts: readonly BankConnectionAccount[];
}

/**
 * `404`/`409` body of the bank-connection and sync routes: the connection or run does not exist
 * (`not-found`), changed meanwhile (`conflict`), already has a run or discovery in progress
 * (`locked`), or the run has no open TAN challenge (`no-challenge`).
 */
export interface SyncError {
  readonly error: 'not-found' | 'conflict' | 'locked' | 'no-challenge';
}

/** A TAN method the bank offers this user. */
export interface TanMethodOption {
  readonly id: number;
  readonly name: string;
  /** Approved in the banking app instead of typing a TAN (e.g. pushTAN 2.0). */
  readonly decoupled: boolean;
  /** Names of the active TAN media for this method. */
  readonly media: readonly string[];
  /** Whether one of `media` must be chosen as `tanMedia`. */
  readonly mediaRequired: boolean;
}

/** An account the bank reports for this login. */
export interface DiscoveredAccount {
  /** What `BankConnectionAccount.accountIdentifier` must hold to map it. */
  readonly identifier: string;
  readonly iban: string | null;
  readonly accountNumber: string;
  /** The bank's product name, or the holder when there is none. */
  readonly name: string | null;
  /** The `konto.id` with the same IBAN or account number, if any. */
  readonly kontoId: number | null;
}

/** A finished discovery. */
export interface DiscoverDone {
  readonly status: 'done';
  readonly tanMethods: readonly TanMethodOption[];
  /** The TAN method the discovery dialog used (the stored one, else the bank's first). */
  readonly selectedTanMethod: number;
  /** Active media of `selectedTanMethod`. */
  readonly tanMedia: readonly string[];
  readonly accounts: readonly DiscoveredAccount[];
}

/**
 * A discovery waiting for a TAN. Answer it with `POST /api/sync/runs/:runId/tan`, watch the run
 * in `GET /api/sync/status`, and once it is `success` read the result from
 * `GET /api/bank-connections/:id/discovery`.
 */
export interface DiscoverTanRequired {
  readonly status: 'tan_required';
  readonly runId: number;
  readonly challenge: TanChallenge;
}

/** Response of `POST /api/bank-connections/:id/discover` (`200`); `409` `locked` while busy. */
export type DiscoverResponse = DiscoverDone | DiscoverTanRequired;

/**
 * How a challenge is answered: type a TAN (`tan`), type the TAN shown by scanning an image
 * (`phototan`, image at `GET /api/sync/runs/:id/challenge-image`), or approve it in the banking
 * app (`decoupled`; the backend polls the bank by itself).
 */
export type TanChallengeKind = 'tan' | 'phototan' | 'decoupled';

/** A TAN challenge a run is waiting on. Open for 15 minutes, then the run is `tan_expired`. */
export interface TanChallenge {
  readonly kind: TanChallengeKind;
  /** The bank's prompt text, to show as is. */
  readonly message: string;
  /** Whether `GET /api/sync/runs/:id/challenge-image` has an image. */
  readonly hasImage: boolean;
}

/** Body of `POST /api/bank-connections/:id/sync` and `POST /api/bank-connections/:id/discover`. */
export type SyncStartRequest = WithUserKey;

/** `202` body of `POST /api/bank-connections/:id/sync`; the run continues in the background. */
export interface SyncStartResponse {
  readonly runId: number;
}

/** One row of `hf_sync_run`. */
export interface SyncRun {
  readonly id: number;
  readonly trigger: SyncTrigger;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: SyncRunStatus;
  readonly error: string | null;
  /** New `umsatz` rows written. */
  readonly inserted: number;
  /** Pending `umsatz` rows the bank no longer sends, removed. */
  readonly deleted: number;
}

/** An open challenge together with the run waiting on it. */
export interface OpenTanChallenge extends TanChallenge {
  readonly runId: number;
}

/** One element of `SyncStatusResponse.connections` (ordered by name). */
export interface SyncConnectionStatus {
  readonly id: number;
  readonly name: string;
  readonly enabled: boolean;
  readonly pausedReason: SyncPausedReason | null;
  readonly lastSyncAt: string | null;
  readonly lastStatus: SyncRunStatus | null;
  readonly lastError: string | null;
  /** The newest run of any trigger, `null` before the first. */
  readonly latestRun: SyncRun | null;
  readonly challenge: OpenTanChallenge | null;
}

/**
 * `GET /api/sync/status`: the user's key state (scheduled syncs only run in `memory` mode while
 * unlocked and in `stored` mode) and every connection's sync state.
 */
export interface SyncStatusResponse {
  readonly key: UserKeyStatus;
  readonly connections: readonly SyncConnectionStatus[];
}

/**
 * Body of `POST /api/sync/runs/:id/tan`. `tan` is required for `tan` and `phototan` challenges and
 * omitted for `decoupled` ones, where the call only acknowledges. `204`; `400` when a required TAN
 * is missing; `409` `no-challenge` when the run is not waiting.
 */
export interface TanAnswerRequest {
  readonly tan?: string;
}
