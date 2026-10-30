/**
 * The signed-in user's own setup: which Hibiscus database they work on, and the key that encrypts
 * their bank PINs. The identity is the username the authenticating proxy asserts; nothing else
 * about the user is stored. One row per username in the app-owned table `hf_app_user`, in the app
 * database (`DB_*`).
 *
 * Passwords and keys are write-only: sent when set, stored encrypted, never returned — except a
 * newly generated key, which `POST /api/user/key` returns exactly once.
 *
 * Declared here once and imported by both packages; never re-declare it on either side.
 */

/**
 * `GET /api/me`. `database`: whether the user has set up their Hibiscus database yet. `key`:
 * whether the user has created their key yet (a key mode is stored). The app is usable once both
 * are `configured`.
 */
export interface Me {
  readonly user: string;
  readonly database: 'configured' | 'unconfigured';
  readonly key: 'configured' | 'unconfigured';
}

/** Where the user's Hibiscus database is. `host` must be on the operator's `ALLOWED_DB_HOSTS`. */
export interface UserDatabaseSettings {
  readonly host: string;
  readonly port: number;
  readonly name: string;
  readonly user: string;
}

/** The stored settings; the password itself is never returned. */
export interface UserDatabase extends UserDatabaseSettings {
  readonly passwordSet: boolean;
}

/**
 * `GET /api/user/database`. `database` is `null` until set up. `allowedHosts`: the operator's
 * allowlist (`host` or `host:port` entries), for the host field.
 */
export interface UserDatabaseResponse {
  readonly database: UserDatabase | null;
  readonly allowedHosts: readonly string[];
}

/**
 * Body of `PUT /api/user/database` — `204`. `password` is required the first time; omitted later
 * keeps the stored one. `400` `host-not-allowed`; `409` `busy` while a sync of the user runs; `409` `database-in-use` when another user has the
 * database.
 * The connection is tested before it is saved; a failing one answers `400` with
 * `UserDatabaseTestResponse`.
 */
export interface UserDatabaseUpdateRequest extends UserDatabaseSettings {
  readonly password?: string;
}

/** Body of `POST /api/user/database/test`; `password` omitted = the stored one. */
export type UserDatabaseTestRequest = UserDatabaseUpdateRequest;

/**
 * `200` body of `POST /api/user/database/test`. `hibiscusSchema`: the database has Hibiscus's
 * tables (`konto`, `umsatz`); without them the app cannot work on it. `error`: why the connection
 * failed, `null` when `ok`.
 */
export interface UserDatabaseTestResponse {
  readonly ok: boolean;
  readonly hibiscusSchema: boolean;
  readonly error: string | null;
}

/**
 * How the user's key may stay on the server:
 * - `manual` — never kept; entered for each "Sync now", dropped when that run ends. No scheduled
 *   syncs.
 * - `memory` — kept in server memory after "Unlock" until "Lock", a restart or a deploy; scheduled
 *   syncs run while unlocked.
 * - `stored` — stored in the app database, encrypted with the server key; scheduled syncs always
 *   run, and whoever controls the server can decrypt the PINs.
 */
export type KeyMode = 'manual' | 'memory' | 'stored';

/** `unlocked`/`locked` only apply to `memory`; the other modes are `not-applicable`. */
export type KeyState = 'unlocked' | 'locked' | 'not-applicable';

/** `GET /api/user/key`. `mode` is `null` until a key is configured. */
export interface UserKeyStatus {
  readonly configured: boolean;
  readonly mode: KeyMode | null;
  readonly state: KeyState;
}

/**
 * Body of `POST /api/user/key`: sets the user's first key. `key` omitted = the server generates
 * one. `mode` is the key mode to start with. `409` `key-configured` when a key exists already
 * (use change or reset).
 */
export interface UserKeyCreateRequest {
  readonly key?: string;
  readonly mode: KeyMode;
}

/** `201` body of `POST /api/user/key` and `200` of `POST /api/user/key/change`: shown once. */
export interface UserKeyCreateResponse {
  /** Base64 of 32 bytes. */
  readonly key: string;
}

/** Body of `PUT /api/user/key/mode` — `204`. `key` is required when switching to `stored`. */
export interface UserKeyModeRequest {
  readonly mode: KeyMode;
  readonly key?: string;
}

/** Body of `POST /api/user/key/unlock` (`memory` mode) — `204`; `400` `key-invalid`. */
export interface UserKeyUnlockRequest {
  readonly key: string;
}

/**
 * Body of `POST /api/user/key/change`: re-encrypts every stored PIN under the new key in one
 * transaction. `newKey` omitted = generated. `400` `key-invalid` for a wrong `oldKey`.
 */
export interface UserKeyChangeRequest {
  readonly oldKey: string;
  readonly newKey?: string;
}

/**
 * Error body of the user routes, and of data and sync routes that need the database or the key:
 * - `database-not-configured` (`409`) — the user has not set up their database.
 * - `host-not-allowed` (`400`) — the host is not on `ALLOWED_DB_HOSTS`.
 * - `busy` (`409`) — a sync of the user is running.
 * - `database-in-use` (`409`) — another user already uses this database (host, port, name).
 * - `key-not-configured` (`409`) — no key yet.
 * - `key-configured` (`409`) — a key exists already.
 * - `key-required` (`400`) — this action needs the key in the request (`manual`, or `memory` while
 *   locked).
 * - `key-invalid` (`400`) — the key does not match.
 * `POST /api/user/key/lock` and `POST /api/user/key/reset` (deletes all stored PINs) answer `204`.
 */
export interface UserError {
  readonly error:
    | 'database-not-configured'
    | 'host-not-allowed'
    | 'busy'
    | 'database-in-use'
    | 'key-not-configured'
    | 'key-configured'
    | 'key-required'
    | 'key-invalid';
}
