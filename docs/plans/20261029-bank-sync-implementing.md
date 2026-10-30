# Bank sync inside Hibiscus Web

## Context

Banking data stops at 2026-07-16 because nothing on the server ever talks to a bank. Only the desktop
Jameica on the Mac does. Its scheduler only runs while the app is open and can reach the LAN-only
`hibiscus-db:3306`. The last session, on 2026-07-29, failed with "Socket fail to connect", and
Jameica hasn't been started since.

The Hibiscus dashboard tile is already done (`b9b75db`, pushed).

Goal: **hibiscus-frontend**, which is always running, fetches transactions and balances itself.
- It syncs every 6 hours.
- Bank connections, accounts and the interval are configured in its web UI.
- TAN prompts are answered there too.
- Rule, rephrased: **"bank credentials never leave the web frontend app."**
- The desktop Hibiscus keeps working on the same rows and does not create duplicates.

Decisions taken:
- Use `lib-fints` (robocode13, LGPL-2.1, maintained; covers decoupled pushTAN, photoTAN,
  MT940/camt and HKSAL; comdirect is on its tested list).
- Store the PIN AES-256-GCM encrypted in the database; the key is an env secret only this
  container gets.
- Register our own FinTS product ID with the Deutsche Kreditwirtschaft (DK) and track it in a
  separate Claude project.

## Key facts

- **Product ID:** every FinTS client must send a DK product registration ID
  (`FinTSConfig.forFirstTimeUse(productId, …)`). Registration is free but takes weeks, so the
  code is built and tested first and real syncs start once the ID arrives.
- **Pending TANs:** lib-fints keeps an open TAN dialog in process memory and can't save it, so a
  pending TAN is lost when the container restarts. Acceptable, since there is only one container.
  Save the bank's parameter data (`bankingInformation`) and reload it with `fromBankingInformation`.
- **Endpoints:**
  - comdirect `https://fints.comdirect.de/fints`.
  - BLZ 70120400 (DAB → Consorsbank infrastructure) `https://brokerage-hbci.consorsbank.de/hbci`.
    Medium-low confidence; the endpoint can be edited in the UI.
- **Duplicate compatibility with the desktop Hibiscus** (`UmsatzImpl.getChecksum()`): a CRC32 over
  `ART`(upper) + konto.id + betrag (Java `Double.toString`) + customerref + empfaenger_blz +
  empfaenger_konto + `NAME`(upper) + primanota + merged purpose text (upper, empty lines dropped,
  joined with a space) + datum `dd.MM.yyyy` + valuta `dd.MM.yyyy` + `"notbooked"` for pending rows.
  A null value becomes the text `"null"`.
  - Rows count as equal when the `txid` matches (if both have one), otherwise when the checksum
    matches.
  - Merging only looks at rows from the batch's earliest date onwards and counts matches, so
    identical bookings can still be inserted several times.
  - Pending rows: `flags=2`, `saldo=0`; ones the bank no longer sends are deleted.
- comdirect asks for a TAN when old transactions are fetched in the background, so fetch only
  from the last booked date minus a few days.

## Design (all in the hibiscus-frontend repo unless noted)

**Tables** (created by `ensureSyncTables()`, like `ensureTaxTagTables()`):
- `hf_bank_connection`:
  - bank: `blz`, `fints_url`, `login_name`, `customer_id`
  - PIN: `pin_ciphertext`, `pin_iv`, `pin_tag`
  - TAN: `tan_method`, `tan_media`
  - `banking_information` JSON, `sync_interval_hours` (default 6), `enabled`, `paused_reason`
  - `last_sync_at`, `last_status`, `last_error`
- `hf_bank_connection_account`: `connection_id`, `konto_id`, `enabled`. Maps each FinTS account
  (IBAN or account number) to its Hibiscus `konto`.
- `hf_sync_run`: `connection_id`, `trigger` (scheduled|manual), `started_at`, `finished_at`,
  `status` (running|tan_required|success|error|tan_expired), `error`, `inserted`, `deleted`.

**Backend modules** (`packages/backend/src/sync/`):
- `credential-crypto.ts`: AES-256-GCM with a fresh IV per write. Key from `BANK_CREDENTIALS_KEY`,
  32 bytes base64, zod-validated, required. The PIN is write-only through the API and is never
  returned or logged.
- `hibiscus-checksum.ts`: an exact port of `getChecksum()`, including Java `Double.toString`
  formatting.
- `umsatz-merge.ts`: a port of `HBCIUmsatzJob.markExecuted`. It maps lib-fints statements to
  `umsatz` columns, the same way `Converter.HBCIUmsatz2HibiscusUmsatz` does (EREF/MREF/CRED tags
  out of the purpose text, `zweck`/`zweck2`/`zweck3` split).
  - It inserts new rows, handles pending rows and updates `konto.saldo`, `saldo_datum` and
    `saldo_available`.
  - It writes a `protokoll` entry ("Umsätze abgerufen", typ 1).
  - All of this happens in one DB transaction per account.
  - Use the statement format the desktop used: no existing row carries `txid` and the
    desktop used MT940 (HKKAZ), so fetch MT940. Changing format would break checksum matching.
- `fints-session.ts`: wraps lib-fints (initial dialog, TAN methods and media, account list,
  statements and balance).
- `sync-service.ts`: runs a sync for a connection.
  - `GET_LOCK('hf_sync_<id>', 0)` allows only one run per connection. A second trigger gets 409.
  - It never fetches two connections at the same time from the same trigger.
- `pending-tan-registry.ts`: keeps the in-memory open dialog per run, with a 15-minute timeout.
  - For decoupled TANs it polls in the background until the bank confirms.
  - For TAN and photoTAN it waits for `POST …/tan`. The photo is served from memory and never
    stored.
- `scheduler.ts`: a tick every minute. A connection is due when it is `enabled`, not paused and
  `last_sync_at + interval` has passed.
  - If a **scheduled** run needs a TAN and nobody answers before the timeout, the run is marked
    `tan_expired` and the connection is paused with `paused_reason='tan'`. That way the next
    6-hourly run doesn't send another pushTAN to the phone at night.
  - A manual "Sync now" clears the pause.

**Required config:** `BANK_CREDENTIALS_KEY`, zod-validated in `config/config.ts`. A missing value
stops startup (core.md: no defaults). **Changed 2026-10-30:** the FinTS product ID is not a
secret. It names the product and ships with every copy, so it is the source constant
`FINTS_PRODUCT_ID` in `sync/fints-session.ts` (`null` until registered; every bank dialog then
throws), not an env var.

**API** (contracts in `packages/shared/src/contracts/sync.d.ts`):
- `GET/POST/PUT/DELETE /api/bank-connections`. The PIN is write-only. PUT uses `expected` and
  answers 409 if the row changed meanwhile, like the existing routes.
- `POST /api/bank-connections/:id/discover`: initial dialog that returns TAN methods, TAN media
  and accounts. It can ask for a TAN itself.
- `PUT /api/bank-connections/:id/accounts`: the account mapping.
- `POST /api/bank-connections/:id/sync`.
- `GET /api/sync/status`: per connection, the last run, any open TAN challenge and the pause
  reason.
- `POST /api/sync/runs/:id/tan` and `GET /api/sync/runs/:id/challenge-image`.

**UI:**
- *Settings → Bank connections*: a list plus an edit form. Fields: BLZ, endpoint (prefilled for the
  two known BLZs), login, customer ID, PIN, TAN method and media after discovery, account mapping
  to Hibiscus accounts, interval, enabled.
- A global sync banner in the shell: "TAN needed" or "Sync paused — the bank wants a TAN. Sync
  now". Plus a TAN dialog (CDK Dialog): a text input for a TAN, the image for photoTAN, a "waiting
  for confirmation in your banking app" spinner for decoupled.
- A "Sync now" button and the last sync time on Accounts.
- i18n keys in en and de.

**ubuntu-server:**
- `docker/compose.yaml`, `hibiscus-frontend` block:
  - `FINTS_PRODUCT_ID=${ENV_HIBISCUS_FINTS_PRODUCT_ID}` and
    `BANK_CREDENTIALS_KEY=${ENV_HIBISCUS_BANK_CREDENTIALS_KEY}`
  - tag bumped to `1.2.0`
- Docs via `/docs-sync`:
  - `banking.md`: rule rephrased to "never leave the web frontend app", and the "no FinTS on the
    server" statement replaced
  - `hibiscus.md`: a sync section; outbound HTTPS to the banks; new `hf_*` tables; key loss means
    re-entering the PINs
  - `environment.md`
- Turn off the desktop Jameica scheduler. The checksums keep the two compatible anyway.

## Phases

### Phase 0 — Product-ID registration project
- **Status:** done
- **Started:** 2026-10-29 09:10
- **Ended:** 2026-10-29 09:25

Done: https://claude.ai/artifact/FtJZ3aN4xewLvuF2CAreFk

Right after approval, create a Claude project (Claude Docs) called "FinTS product registration".
Contents: why the ID is needed, the DK registration steps and form (hbci-zka.de), the details to
submit (product name "hibiscus-frontend", version, manufacturer, contact), a status checklist, and
where the ID goes once it arrives (`ENV_HIBISCUS_FINTS_PRODUCT_ID`).

### Phase A — Checksum + merge core (hibiscus-frontend)
- **Status:** done
- **Started:** 2026-10-29 09:30
- **Ended:** 2026-10-29 09:46

Golden check: 9950/9965 match (5265 UTF-8, 4685 windows-1252 legacy checksums, matched too); 15 rows edited after insert. Duplicate counting keeps Hibiscus' `<=` deliberately.

`hibiscus-checksum.ts` and `umsatz-merge.ts` with Vitest specs.

**Golden test:** a local script recomputes the checksum for every `umsatz` row of a dump of the
real data in the dev DB. It must match the stored `checksum` on 100 % of the rows; the dump is
never committed. The merge is checked with an MT940 fixture re-fetched against existing rows:
nothing new may be inserted.

### Phase B — FinTS session, sync service, scheduler, API (hibiscus-frontend; parallel to A, merge API pinned)
- **Status:** done
- **Started:** 2026-10-29 09:35
- **Ended:** 2026-10-29 10:10

Deviations: lib-fints pinned to 1.5.3; raw `:86:`/`:61:` captured via Mt940Parser hooks (lib-fints parsing is lossy); pending (MT942) rows not delivered by lib-fints, so Hibiscus' "no pending rows" rule applies; discovery got its own run (`trigger_type='discover'`) and `GET /:id/discovery`; DELETE takes the sync lock.

Add `lib-fints`, plus the crypto, tables, `fints-session`, `pending-tan-registry`, `sync-service`,
`scheduler`, routes and contracts. Specs use a lib-fints fake: TAN flow, decoupled polling,
timeout → pause, lock → 409, PIN never in responses or logs.

### Phase C — UI (hibiscus-frontend; parallel to B once contracts exist)
- **Status:** done
- **Started:** 2026-10-29 10:05
- **Ended:** 2026-10-29 10:40

Tag `1.2.0` still to cut on commit. Initial bundle 739 kB vs 697 kB before (budget warning pre-existed).

Bank connections settings page, sync banner, TAN dialog, Sync now, i18n. Update
`docs/architecture.md` (API, data model, sync and credential section). Cut tag `1.2.0`.

### Phase D — Stack integration (ubuntu-server; after the tag)
- **Status:** in progress
- **Started:** 2026-10-29 10:45
- **Ended:**

Compose env + tag bump, `/docs-sync`, plan file in `docs/plans/`. You add `ENV_HIBISCUS_BANK_CREDENTIALS_KEY`
(`openssl rand -base64 32`) and, once it arrives, the product ID to `ubuntu-server.prod.env`.

## Execution

| Step | Agent | Model/effort | Wave | Write set | Reads |
|---|---|---|---|---|---|
| 0 | main session | — | 1 | Claude Docs project | — |
| A | implementer | opus/high | 1 | `packages/backend/src/sync/{hibiscus-checksum,umsatz-merge}*` | Hibiscus facts above, `repositories/umsatz.ts` |
| B1 | implementer | opus/high | 2 | `packages/backend/src/sync/*` (rest), `routes/bank-connections.ts`, `routes/sync.ts`, `config/config.ts`, `packages/shared/src/contracts/sync.d.ts` | tax-tag route/repo as pattern |
| C | implementer | sonnet/medium | 3 | `packages/frontend/src/app/features/{bank-connections,sync}/`, shell banner, i18n, `docs/architecture.md` | contracts from B1, `features/categories` dialogs |
| D | implementer-light | sonnet/low | 4 | ubuntu-server `docker/compose.yaml`, docs | — |

## Verification

- hibiscus-frontend: `pnpm format:check && pnpm lint && pnpm test && pnpm build`, all green.
- Golden checksum test: 100 % match against the real dump.
- Local end-to-end once the product ID exists: add a comdirect connection, discover, map the
  accounts, Sync now, answer the pushTAN. New `umsatz` rows appear and `saldo_datum` is today.
  Opening the desktop Hibiscus against the same DB and syncing creates **no duplicates**.
- Before the ID arrives: run the full flow against the fake and confirm that startup fails without
  `FINTS_PRODUCT_ID` or `BANK_CREDENTIALS_KEY`.
- Server after the deploy: `SELECT MAX(datum) FROM umsatz` moves past July; the next scheduled run
  happens ≤ 6 h later (`hf_sync_run`); `service-index.sh check` passes.
