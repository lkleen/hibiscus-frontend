# Multi-user Hibiscus Web

## Context

Bank sync (1.2.0) has been tagged and pushed, but not deployed yet. The ubuntu-server change for
it is uncommitted. Today hibiscus-frontend is single-tenant:

- one database from `DB_*`;
- every Hibiscus table is shared by everyone in `ALLOWED_USERS`;
- one server key (`BANK_CREDENTIALS_KEY`) encrypts every bank PIN.

Goal: every Authentik user works on **their own Hibiscus database** and controls **their own
encryption key** for bank credentials.

- Each user configures the database connection in the web UI.
- Each user chooses whether and how the key may stay on the server for automatic sync. The UI
  explains the risk of each choice.
- Manual "Sync now" is always available.
- Database hosts are limited to an admin allowlist.
- Nothing from the IdP is duplicated. The username header is the only identity, and the app
  stores one small record per username.

## Decisions

- **App record per user lives in the app database** (`DB_*`, today the `hibiscus` DB).
  - One new table `hf_app_user`, keyed by the IdP username.
  - No new database, no manual SQL, no new library.
  - Covered by the existing nightly dump.
- **Each user's Hibiscus database password** is encrypted with the **server key**
  (`BANK_CREDENTIALS_KEY`, AES-256-GCM, existing `CredentialCrypto`). The app must be able to show
  your data without your key, so this one can't be locked with it.
- **Bank PINs** are encrypted with the **user key** only.
  - The key is 32 random bytes, generated in the app and shown once as base64 for the password
    manager. Pasting your own 32-byte key works too.
  - The app stores a check value, `HMAC-SHA256(key, "hibiscus-frontend key check")`, to verify a
    key that is entered.
- **Key modes**, chosen per user, each with a risk text in the UI:

  | Mode     | Key kept                                                                         | Scheduled sync      | Sync now   |
  | -------- | -------------------------------------------------------------------------------- | ------------------- | ---------- |
  | `manual` | never: entered for each sync, dropped when the run (including its TAN wait) ends | no                  | key prompt |
  | `memory` | server RAM after "Unlock", until "Lock", restart or deploy                       | yes, while unlocked | yes        |
  | `stored` | DB, wrapped with the server key                                                  | always              | yes        |

  Switching to `stored` asks for the key once. Switching away deletes the wrapped copy.
  "Change key" takes the old and the new key and re-encrypts all PINs in one transaction. A
  forgotten key means re-entering the PINs: "Reset key" deletes them after a confirmation.

- **Host allowlist:** new required env `ALLOWED_DB_HOSTS` (comma-separated `host` or `host:port`).
  It is checked when the settings are saved and again before every pool is created.
- **Release `2.0.0`**, because the config changes. 1.2.0 was never deployed, so its PINs (none on
  the server) need no migration.

## Design (hibiscus-frontend)

**Per-user database context** (the core change; repositories stay untouched):

- `db/pool.ts`:
  - `getPool()` returns the **current user's** pool from an `AsyncLocalStorage` context.
  - It throws when there is no context, or when the user has no database configured.
  - `getAppPool()` is the `DB_*` pool for `hf_app_user`.
- `db/user-pools.ts`: a cache `Map<username, {pool, version}>`.
  - Pools are created lazily (mysql2, `connectionLimit: 5`).
  - Changing the database settings raises the version, and the old pool is ended.
  - Changes are refused with 409 while that user has a sync running.
  - Per pool, `ensureUserSettingTable` / `ensureTaxTagTables` / `ensureSyncTables` run **once**,
    as a memoised promise, so two first requests don't race the DDL.
- `middleware/user-db.ts`: runs after `auth`.
  - Resolves `res.locals.user` to its pool and runs the rest of the request in `als.run(...)`.
  - A user without a database gets `409 {error:'database-not-configured'}` on data routes.
  - `/api/me` and `/api/user/*` work without a database.
- **Startup:** the `ensure*Tables` calls leave `server.ts` and run per pool. `server.ts` ensures
  only `hf_app_user` on the app pool.

**Lock names must include the database.** `GET_LOCK` is server-wide, so two users on the same
MariaDB with bank connection id 1 would block each other. The name becomes
`hf_sync_<sha1(db host:port/name)>_<id>`, which stays under 64 characters.

**User key handling** (`sync/user-keys.ts`):

- `UserKeyStore` is an in-memory `Map<username, Buffer>` for `memory` mode, cleared on lock.
- `resolveKey(user, mode, entered?)`:
  - `manual`: the entered key, checked against the check value.
  - `memory`: the map, else `KeyLockedError`.
  - `stored`: unwrapped with the server key.
- `CredentialCrypto` is instantiated **per user key** for PINs. The server-key instance is kept
  only for database passwords and wrapped keys.

**Sync for many users:**

- `scheduler.ts`: each tick lists the `hf_app_user` rows that have a database and mode
  `memory`/`stored`, then works through them one at a time.
  - For each user: `als.run(userContext, …)`, resolve the key (skip quietly when `memory` is
    locked, so status shows "locked"), then the existing due-connection loop on that user's
    database.
  - One failing user database is logged and doesn't stop the others.
  - The in-flight guard stays.
- `sync-service.ts`: `startSync` / `discover` take `{connectionId, trigger, key}`. A manual sync in
  `manual` mode gets the key from the request body and keeps it only in the run's closure.
- Status gains `keyMode` and `keyState` (`unlocked | locked | n/a`) for the banner.

**Routes** (contracts in `packages/shared/src/contracts/user.d.ts`; `sync.d.ts` extended):

- `GET/PUT /api/user/database`: host, port, name, user; the password is write-only.
  `POST /api/user/database/test` checks a connection, with the allowlist enforced.
- `GET /api/user/key` (mode, state, configured).
  - `POST /api/user/key`: set a new key, or generate one. The response contains the key exactly
    once.
  - `PUT /api/user/key/mode {mode, key?}`.
  - `POST /api/user/key/unlock {key}`, `POST /api/user/key/lock`.
  - `POST /api/user/key/change {oldKey, newKey}`, `POST /api/user/key/reset`.
- `POST /api/bank-connections/:id/sync` and `…/discover` take an optional `{key}`, which is
  required in `manual` mode. Creating a connection or changing a PIN also needs the key in
  `manual` and `memory`-locked modes.
- `GET /api/me` gains `database: 'configured' | 'unconfigured'`.

**UI:**

- **First run:** a `:locale/setup` route with a `canMatch` guard on the `:locale` children redirects
  there while `database === 'unconfigured'`. It sets up the database connection (host field
  showing the allowed hosts, test button), then the key (generate and copy, or paste), then the
  mode.
- **Settings:** a new "Database" tab and a new "Encryption key" tab. The key tab has the mode radio
  group with the risk text for each mode, unlock/lock, change and reset.
- **Sync now and Discover** open a key prompt in `manual` mode, and in `memory` mode while locked
  (with "keep unlocked" offered).
- **Banner:** "Syncing paused: unlock your key" when in `memory` mode and locked with enabled
  connections.
- i18n keys in en and de; `docs/architecture.md` (multi-user, key modes, threat model per mode,
  allowlist) and the README updated.

**Config** (`config/config.ts`): `ALLOWED_DB_HOSTS` is required. `DB_*` is now "the app database".
`BANK_CREDENTIALS_KEY` stays, as the server key.

## ubuntu-server (after tag 2.0.0)

- `docker/compose.yaml`: the tag becomes 2.0.0. Add `ALLOWED_DB_HOSTS=hibiscus-db`. The
  `BANK_CREDENTIALS_KEY` line is already prepared but uncommitted.
- Docs via `/docs-sync`:
  - `hibiscus.md`: multi-user, per-user DB and key modes; the "credentials never leave the web
    frontend app" wording stays.
  - `environment.md`: the server key now wraps DB passwords and `stored`-mode keys.
- After the deploy: you open the app, configure `hibiscus-db` / `hibiscus` as your database, and
  generate a key.

## Phases

### Phase 0 — Shared contracts (main session)

- **Status:** done
- **Started:** 2026-10-30 10:20
- **Ended:** 2026-10-30 10:30

`packages/shared/src/contracts/user.d.ts` (new, incl. `Me` moved from the frontend) and the
`WithUserKey` / `SyncStartRequest` / `SyncStatusResponse` additions to `sync.d.ts`.

### Phase A — Per-user DB context (backend)

- **Status:** done
- **Started:** 2026-10-30 10:35
- **Ended:** 2026-10-30 11:05

A host removed from `ALLOWED_DB_HOSTS` makes `/api/me` report `unconfigured` (back to setup).

`pool.ts` with ALS, `user-pools.ts`, `user-db` middleware, `hf_app_user` + repository,
per-pool ensure, database routes + allowlist, `/api/me` status, lock names with the database hash.
Specs: two users isolated, ensure runs once under concurrent first requests, allowlist rejects,
pool swap is refused while a sync runs.

### Phase B — User keys + multi-user sync (backend; after A)

- **Status:** done
- **Started:** 2026-10-30 11:10
- **Ended:** 2026-10-30 12:05

Busy/reconfiguring registry in `db/user-activity.ts`; sync takes a key _source_, resolved after
the busy mark; reset nulls the PINs and disables the connections; change-key spans two databases
(key row written just before the PIN transaction commits, restored on failure). Follow-ups:
`Me.key` flag, one user per Hibiscus database (`database-in-use`).

`user-keys.ts`, key routes, PIN crypto per user key, scheduler across users, the `key` parameter
for sync and discover, status `keyMode` / `keyState`. Specs: each mode's behaviour, a wrong key
gives 400 and never touches a PIN, change-key re-encrypts atomically, a locked `memory` user is
skipped, the PIN and keys never appear in responses or logs.

### Phase C — UI (frontend; parallel to B once contracts are pinned)

- **Status:** done
- **Started:** 2026-10-30 10:35
- **Ended:** 2026-10-30 12:00

The auth demo got its own MariaDB (`demo-db`), because the app database must be reachable at
startup now.

Setup flow and guard, Database and Encryption key tabs, key prompt for Sync now and Discover,
banner states, i18n, `docs/architecture.md`. Tag `2.0.0`.

**README: a complete "Setting up hibiscus-frontend" guide**, rewritten for the multi-user version
and checked against `.env.example` and `config/config.ts`:

1. **Operator setup:**
   - the authenticating proxy requirement and the auth contract (`AUTH_HEADER_USER`,
     `ALLOWED_USERS`, `INTERNAL_PROXY_SECRET`);
   - the app database (`DB_*`, holds `hf_app_user`);
   - `ALLOWED_DB_HOSTS`;
   - `BANK_CREDENTIALS_KEY` (what it protects, generating it, keeping a copy);
   - Docker run / compose example; outbound HTTPS to the banks.
2. **Preparing a Hibiscus database for a user:** a MariaDB database and user, Hibiscus's
   `mysql-create.sql` schema or a dump of existing data. The app adds its `hf_*` tables on first
   connect.
3. **First login per user:** database connection, generating and saving the key, choosing a key
   mode, with the same risk text as the UI.
4. **Adding a bank connection:** discover, account mapping, TAN handling, Sync now.
5. **The FinTS product ID** is built in; forks register their own.

The local-development section stays and gets the second-user test setup.

### Phase D — Stack (ubuntu-server)

- **Status:** todo
- **Started:**
- **Ended:**

Compose and env template, `/docs-sync`, commit. Push once you have added `ENV_HIBISCUS_BANK_CREDENTIALS_KEY`.

## Execution

| Step | Agent        | Model/effort | Wave                               | Write set                                                                                                                                                                                                                     | Reads                                  |
| ---- | ------------ | ------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| A    | implementer  | opus         | 1                                  | `db/`, `middleware/user-db.ts`, `repositories/app-user.ts`, `routes/user-database.ts`, `routes/me.ts`, `server.ts`, `config/config.ts`, `sync/sync-service.ts` (lock name only), `shared/contracts/user.d.ts` (database part) | `pool.ts`, `auth.ts`, the repositories |
| B    | implementer  | opus         | 2                                  | `sync/*` (except merge/checksum), `routes/{bank-connections,sync,user-key}.ts`, `shared/contracts/{sync,user}.d.ts`                                                                                                           | output of A                            |
| C    | implementer  | sonnet       | 2 (contracts pinned in the prompt) | `packages/frontend/**`, i18n, `docs/architecture.md`, `README.md`                                                                                                                                                             | contracts                              |
| D    | main session | —            | 3                                  | ubuntu-server compose, env template, docs                                                                                                                                                                                     | —                                      |

## Verification

- `pnpm format:check && pnpm lint && pnpm test && pnpm build` from the hibiscus-frontend root.
- Locally with two users (the dev proxy's identity header switched): user 1 on the dev DB with real
  data, user 2 on an empty second database (allowlisted).
  - Each sees only their own accounts.
  - `memory` mode: unlock, then a scheduler tick runs user 1's sync; a restart shows "locked".
  - `manual` mode: Sync now asks for the key; a wrong key gives 400.
  - `stored` mode: syncs survive a restart.
  - A disallowed host is rejected.
- Real bank syncs still wait for the FinTS product ID.
