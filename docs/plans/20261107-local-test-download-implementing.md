# Local test download with demo data or an existing MariaDB

Plan of record: this file. Status: **implementing**.

## Context

People who want to look at hibiscus-frontend today need Docker, a forward-auth proxy and a
Hibiscus MariaDB. Every GitHub release should therefore come with a download that starts
locally with no setup and opens the app on `localhost`.

At startup the user picks one of two modes:

- **Demo data:** an in-memory mock. Its data is read on startup from a compressed file shipped
  in the download. No database is needed.
- **Existing MariaDB:** connect to a Hibiscus database the user already has.

The user's decisions:

1. One archive per OS, each with the official Node 22 runtime.
2. Demo mode does not fake the API. The backend's database access moves behind **injectable
   repositories**, and demo mode injects in-memory implementations filled from a compressed data
   file (gzip-compressed JSON, read with `node:zlib`; no new dependency).

Facts this rests on:

- The backend has no native modules (`mysql2` and `lib-fints` are pure JS).
- Repositories are module functions today. They find their pool through `getAppPool()` or the
  per-request AsyncLocalStorage (`db/pool.ts`).
- SQL outside the repositories: `SyncService` (`GET_LOCK`, the sync transaction, `fetchStart`)
  and `sync/umsatz-merge.ts`.
- Routes branch on MySQL error codes: `ER_DUP_ENTRY`, `ER_NO_REFERENCED_ROW_2` (including
  constraint names in categories) and `ER_ROW_IS_REFERENCED_2`.
- Route specs `vi.mock` the repository modules.

**Auth contract is unchanged.** The backend still refuses any request without the identity
header and the secret. The launcher is just another forward proxy, like
`packages/frontend/proxy.config.mjs`:

- It binds only to `127.0.0.1`, uses a fixed local identity and a random secret per launch.
- The backend runs on a random port. Even if that port is reachable from the network, nobody can
  enter it without the per-launch secret.

**New required env var `DATA_SOURCE` (`mariadb` | `demo`).** Under the project's
no-silent-defaults rule, an optional variable that falls back to `mariadb` when missing is not
allowed. So every existing deployment must add `DATA_SOURCE=mariadb`. That is a breaking config
change, so the next release is **3.0.0**. `DB_*` and `ALLOWED_DB_HOSTS` are required only for
`mariadb` (a Zod discriminated union in `config/config.ts`).

## Design

### Backend: repositories behind interfaces

- **One interface per repository**, next to its MySQL class in the existing file. For example,
  `repositories/umsatz.ts` exports `TransactionRepository` and `MysqlTransactionRepository`, which
  wraps today's functions unchanged.
  - Interfaces: `AppUserRepository`, `AccountRepository`, `TransactionRepository`,
    `CategoryRepository`, `TaxSectionRepository`, `TaxTagRepository`, `UserSettingRepository`,
    `BankConnectionRepository`, `SyncRunRepository`.
  - Method signatures stay the current function signatures. Backend-only types
    (`AppUser*Record`, `BankConnectionRecord`, `SyncRunResult`, …) stay where they are. Row types
    come from `@hibiscus-frontend/shared/contracts/*`, never mirrored.
- **Aggregate**: `repositories/repositories.ts` with `interface Repositories { … }` and
  `createMysqlRepositories()`. `server.ts` passes `repos` into every router factory. Routers that
  take no arguments today (accounts, transactions, categories, settings, tax-sections, tax-tags)
  get a `deps` object. `UserKeys`, `SyncService`, `SyncScheduler` and `UserPools` receive the
  repositories they use the same way, typed narrowly with `Pick<…>` as is done today.
- **Domain errors** in `repositories/repository-errors.ts`:
  - `DuplicateKeyError`
  - `MissingReferenceError` with `reference: 'category' | 'parent' | 'account' | 'tax-section' | 'konto'`
  - `StillReferencedError`

  The MySQL classes translate the `ER_*` codes and constraint names into these errors; the mock
  classes throw them directly. Routes catch only domain errors, so no MySQL knowledge is left in
  `routes/`. `applyTaxTagUpdate(connection, …)` stays a private detail of the MySQL
  implementation.
- **User databases**: `interface UserDatabases` (`acquire`, `databaseStatus`,
  `listUsersWithDatabase`, `invalidate`). `UserPools` implements it. `UserDatabaseHandle.pool`
  becomes `Pool | null`, and `getPool()` throws for a handle without a pool (the demo handle).
  `createUserDbMiddleware`, `me` and the scheduler take the interface.
- **Sync database**: `interface SyncDatabase` takes over the raw SQL in `SyncService`:
  - `lock(connectionId)`, which returns a handle with `release()`
  - `runInTransaction(handle, work)`
  - `fetchStart(handle, kontoId)`
  - `merge(handle, params)`

  `MysqlSyncDatabase` holds today's `lock`/`unlock`/`syncAccount`/`fetchStart` code and calls
  `mergeStatement`. `SyncService` no longer imports `db/pool`.
- **Shared pure logic**, so both implementations use one copy:
  - `createsCycle` (from `umsatztyp.ts`) moves to `categories/category-tree.ts`.
  - `TRANSACTION_COLUMNS` and `TAX_SECTION_COLUMNS` stay the single source.
  - `tax/tax-section-defaults.ts` seeds both implementations.

### Backend: demo implementation (`packages/backend/src/demo/`)

- `demo-dataset.ts`:
  - `interface DemoDataset { accounts: AccountRow[]; categories: CategoryRow[]; transactions: TransactionRow[]; taxTags: TaxTag[] }`, typed with the shared contracts.
  - `loadDemoDataset(path)` gunzips and parses the file, checks its structure and throws on
    anything invalid.
- `demo-store.ts`: one in-memory store per process. A single local user; changes live only until
  the process stops.
- `demo-*-repository.ts`: one class per repository interface, working on the store. Each must
  keep MariaDB's behaviour:
  - optimistic `<=>` checks (null-safe compare of `expected` against current);
  - a no-op update still counts as `updated`;
  - FK checks and cascades (connection → accounts and runs; category → tax tag; section code
    rename → tags; deleting a referenced section → `StillReferencedError`);
  - all-or-nothing `assignCategory`;
  - `St-0` seeded and hidden;
  - the `TransactionsResponse` column/row-array format;
  - date fields as strings.
  - **Race-condition rule:** every check-then-write runs synchronously with no `await` in
    between, so it stays atomic on the event loop.
- `DemoUserDatabases`: always `configured`, with a fixed demo handle. Its settings are
  `host: 'demo'`; it is used only for the `GET_LOCK` name.
- `DemoSyncDatabase`:
  - `lock` is an in-process per-connection mutex (needed by `deleteConnection`).
  - `fetchStart`/`merge` throw "Bank sync is not available with demo data".
- `isBankSyncEnabled()` becomes `false` in demo mode, regardless of `FINTS_PRODUCT_ID`. It takes
  the config as a parameter.
- `server.ts` builds `Repositories`, `UserDatabases` and `SyncDatabase` from
  `config.DATA_SOURCE`. `ensureAppUserTable` runs only for `mariadb`.
- **Setup gate:** demo mode must open straight into the app. The implementer checks what the
  `/me` setup gate requires and seeds it in the demo app-user store: the database record, plus key
  state if the gate demands it.
- **Database settings:** in demo mode `/user/database` test and save return 409 `demo-mode`
  (a new `UserError` code in `contracts/user.d.ts`).
- **Data file:** `DEMO_DATA_FILE` is not a new env var. The file sits at a fixed path next to
  `dist`, the same way `public/` is found today.

### Demo data

- A deterministic generator, `packages/backend/scripts/generate-demo-data.ts`, run as part of the
  backend `build`, writes `packages/backend/demo-data/demo-data.json.gz`. The output is gitignored
  and only the generator is committed, so no binary sits in git and the data is reviewable as code.
- **A story, not noise.** The data shows that the app handles a large amount of data: roughly
  12 years, aiming at ~25,000 transactions. It follows one fictitious account owner, Tobias
  Testmann (all names, IBANs `DE00…` and counterparties invented). The story is laid out as code,
  in phases with their own recurring patterns and one-off events:
  - **2014:** single, small cheap flat, modest starting salary. Groceries, pizza delivery, the
    occasional questionable online purchase.
  - **2014–2017:** salary rises once a year. Moves to a bigger flat. Increasingly funny,
    sometimes expensive buys (e.g. a professional espresso machine he uses twice, an inflatable
    hot tub for the balcony, a robot vacuum that gets a name and a birthday cake).
  - **2018:** buys a used car. From then on: car insurance, tax, fuel, workshop bills, parking
    tickets, and a car wash subscription he never uses.
  - **2020:** marries Sabine. A joint account (Gemeinschaftskonto) opens. Wedding costs.
    Now and then absurdly over-the-top presents (a star named after her, an alpaca hike, an oil
    portrait of the cat as a Renaissance noble).
  - **2021:** they buy an old house. Mortgage instalments (Baufinanzierung), a renovation phase
    with hardware-store runs, craftsmen, a skip rental and "emergency plumber, Sunday".
  - **2022:** job change with a major salary increase.
  - **2022–2023:** pregnancy, then Emil arrives in 2023: pharmacy, baby gear, child benefit
    (Kindergeld) coming in, daycare fees later, and a sharp drop in restaurant visits.
  - **Throughout:** travelling (flights, hotels, the one trip where everything went wrong) and
    good restaurants. Insurance, phone and streaming subscriptions (one forgotten subscription
    running for years), refunds and returns.
  - **Humour:** the purposes (`zweck`) and counterparties are written to make the reader laugh
    now and then, for example "Ersatz für Ersatzschlüssel (3.)" or "Hornbach – 4. Besuch heute".
    Most rows stay realistic, so the jokes stand out.
- **Accounts:** Girokonto, Tagesgeld, Kreditkarte, Gemeinschaftskonto from 2020 and
  Baufinanzierung from 2021. Balances must stay plausible: transfers to savings, credit card
  settlement from the Girokonto.
- **Categories:** a Hibiscus-like category tree that covers the story (housing, car, child,
  travel, …), with some tax tags (e.g. craftsmen's labour costs, donations, childcare costs).
  A few percent of rows are left uncategorised.
- **Reproducible:** a seeded PRNG plus fixed story dates. The data runs from 2014-01 up to the
  generation date; see the open follow-up below. It never contains real data (checklist rule).

### Frontend

- `Me` gets `dataSource: 'mariadb' | 'demo'` (shared contract, set in `routes/me.ts`).
- In demo mode the app shell shows a small "Demo data – changes are not saved" badge, and the
  Settings → Database tab is read-only with a notice.
- i18n keys go into both `en.json` and `de.json`.
- Per the saved preference, the UI step invokes `frontend-design:frontend-design` first.

### Launcher (`packages/launcher`, new workspace package, TS compiled by `tsc`)

1. Asks for the mode: `[1] Demo data  [2] Connect to an existing MariaDB`. Flags `--demo`,
   `--mariadb` and `--port <n>` skip the prompt.
2. For MariaDB it asks for host, port, database, user and password (password input hidden). That
   database is both the app database and the Hibiscus database (like local dev), and
   `ALLOWED_DB_HOSTS=<host>:<port>`. The user then completes the normal first-login setup in the
   browser with the same values.
3. Secrets:
   - `INTERNAL_PROXY_SECRET` is random for every launch.
   - `BANK_CREDENTIALS_KEY` is persisted in `~/.hibiscus-frontend-local/server-key` (mode 0600)
     for MariaDB mode, because it encrypts the stored database password. In demo mode it is
     random per launch.
   - Nothing else is stored, so the password is asked at every MariaDB start.
4. Starts the backend as a child process: `process.execPath app/dist/server.js` with an explicit
   env (`DATA_SOURCE`, `PORT=<free port>`, `AUTH_HEADER_USER=X-Forwarded-User`,
   `ALLOWED_USERS=local@localhost`, …). It waits until the backend port accepts connections.
5. Starts a `node:http` forward proxy on `127.0.0.1:<port>` (default 8080, the next free port if
   taken). It streams every request to the backend and sets `X-Forwarded-User` and
   `X-Internal-Auth-Secret`, overwriting any value the client sent.
6. Opens the browser (`open` / `xdg-open` / `cmd /c start`) and prints the URL.
7. Ctrl+C or a backend exit stops both.

Lint and test follow the existing package setup. Specs cover argument parsing, header injection
and overwriting, and the env built for each mode.

### Release packaging

- `scripts/package-release.sh <version>`:
  1. Runs `pnpm build`.
  2. Assembles `app/`:
     - `pnpm --filter @hibiscus-frontend/backend deploy --prod --legacy` for `dist` plus the
       production `node_modules`;
     - the frontend `dist/frontend/browser` as `public/`;
     - `demo-data/`;
     - the launcher's `dist`.
  3. For each target (`linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`, `win-x64`) it
     downloads Node `$NODE_VERSION` from nodejs.org, verifies it against `SHASUMS256.txt` and
     builds `hibiscus-frontend-<version>-<target>`:
     - `node/`, `app/`
     - `start.sh` (or `start.cmd`), which runs `node/bin/node app/launcher/dist/main.js "$@"`
     - `README.txt`
  4. Packs `.tar.gz` for Linux and macOS (keeps the exec bits) and `.zip` for Windows.
- `.github/workflows/release.yml`:
  - Triggers on push of tags `[0-9]+.[0-9]+.[0-9]+`, plus `workflow_dispatch` for a dry run that
    uploads workflow artifacts and does not create a release.
  - Runs on `ubuntu-latest`: checkout, pnpm, Node from `.nvmrc`, `pnpm install --frozen-lockfile`,
    then lint, test and build, then `package-release.sh`, then
    `gh release create "$TAG" … --generate-notes` (`permissions: contents: write`).
  - Action versions pinned. `NODE_VERSION` is pinned in the workflow env as the single source,
    passed to the script.

### Docs and config

- `README.md`:
  - a new section "Try it locally (no Docker)": download, unpack, run `start.sh`/`start.cmd`, the
    two modes, the macOS quarantine hint;
  - `DATA_SOURCE` in the env table and in the Compose example.
- `.env.example` and `docker-compose.auth-demo.yml` get `DATA_SOURCE=mariadb`.
- `docs/architecture.md`: repositories and DI, demo mode, the launcher as a localhost forward
  proxy (auth section), the release pipeline.
- `CLAUDE.md` context table: add a "Demo data / launcher / release packaging →
  `docs/architecture.md`" row.

## Phases and execution

All phases start as **todo**, with no timestamps.

| Step | Phase | Agent | Model / effort | Wave | Write set | Reads |
|---|---|---|---|---|---|---|
| A1 | Interfaces, domain errors, `Repositories`, `UserDatabases`, `SyncDatabase`, `DATA_SOURCE` config, contract changes (`Me.dataSource`, `demo-mode`), `DemoDataset` type | implementer | opus / high | 1 | `repositories/repositories.ts`, `repositories/repository-errors.ts`, interface exports in `repositories/*.ts`, `db/pool.ts`, `config/config.ts(+spec)`, `sync/sync-database.ts`, `demo/demo-dataset.ts`, `shared/contracts/user.d.ts` | this plan, exploration map |
| A2 | MySQL classes + DI for accounts, transactions, categories, tax sections/tags, settings; routes and specs use domain errors and injected fakes | implementer | sonnet / medium | 2 | those repositories, routes and specs, `categories/category-tree.ts` | A1 output |
| A3 | MySQL classes + DI for app-user, bank-connection, sync-run; `MysqlSyncDatabase`; `SyncService`, `UserKeys`, scheduler, `UserPools`, me/user-database/user-key/bank-connections/sync routes; specs | implementer | opus / high | 2 | those files and specs | A1 output |
| B1 | Story-driven demo data generator (phases, events, funny purposes, ~25k rows) + build step + gitignore | implementer | opus / high | 2 | `backend/scripts/generate-demo-data.ts`, `backend/package.json`, `.gitignore` | `DemoDataset`, contracts |
| B2 | Demo repositories, store, `DemoUserDatabases`, `DemoSyncDatabase`, specs | implementer | opus / high | 2 | `backend/src/demo/*` | A1 interfaces, MySQL SQL semantics |
| C1 | Launcher package + specs | implementer | sonnet / medium | 2 | `packages/launcher/**`, `pnpm-workspace.yaml` (if needed) | config env contract |
| D1 | Frontend demo badge + read-only database tab + i18n | implementer | sonnet / medium | 2 | `packages/frontend/src/app/**` (shell, settings/database), `i18n/*.json` | `Me` contract |
| A4 | `server.ts` wiring by `DATA_SOURCE`, demo setup-gate seeding, bank sync off in demo, `/user/database` demo guard | implementer | opus / medium | 3 | `server.ts`, `sync/fints-session.ts`, `routes/user-database.ts`, `routes/me.ts` | A2, A3, B2 |
| E1 | `scripts/package-release.sh` + `.github/workflows/release.yml` | implementer | sonnet / medium | 3 | those two files, `Dockerfile` only if layout sharing helps | C1 layout, B1 output path |
| F1 | Docs and config: README, `architecture.md`, `.env.example`, compose, `CLAUDE.md` table | implementer-light | sonnet / low | 4 | docs and config files | all of the above |
| G1 | Quality gates and end-to-end verification (main session) | main | — | 4 | fixes only | — |

Each phase in the plan of record gets the template block: status, started, ended.

## Open follow-up: demo data up to today

This is not decided in this plan. The date range presets are relative and resolved against
today (`core/utils/date-range.ts`, `RelativeDatePreset`), so an archive from an older release
would open on an empty current month. Options:

- **a) Regenerate per release (built in already).** Data ends on the release's build date. It
  still ages until the next release.
- **b) A demo default range.** The demo store seeds the user's date presets so the first one is a
  fixed range covering the last 12 months that actually contain data. It is cheap and always shows
  data, but it is not "today".
- **c) Continue to today at load time.** The file holds the story up to its generation date. On
  load, the demo store appends the recurring patterns of the last story phase (salary, rent,
  groceries, …) from that date up to today, deterministically per date. This needs the
  recurring-pattern part of the generator in the backend runtime.

Leaning: **b** now, **c** if a demo should always look current.

## Verification

1. `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build`, all green
   with no warnings.
2. A shared behaviour spec runs against the demo repositories:
   - optimistic conflicts, no-op update, FK errors and cascades, cycle detection, all-or-nothing
     assign, `St-0` hidden;
   - transaction row format matching `TRANSACTION_COLUMNS`.
3. MariaDB regression: `pnpm start:local` with `DATA_SOURCE=mariadb` against the dev DB. Check
   accounts, transactions, category edits and tax sections in the browser through
   claude-in-chrome.
4. Local package: `scripts/package-release.sh 0.0.0-test` (current OS target), unpack it, run
   `start.sh`:
   - **Demo:** the browser opens on `127.0.0.1:8080` with the demo badge and demo accounts and
     transactions. Editing a category works. A restart resets the data.
   - **MariaDB:** connect to the dev DB and complete the setup page. Real data shows.
   - `curl -H 'X-Forwarded-User: x' http://127.0.0.1:<backend-port>/api/me` without the secret
     returns 401/403. The proxy port is not reachable on the LAN address.
5. Docker image with `DATA_SOURCE=mariadb` starts. Without `DATA_SOURCE` startup fails with a
   clear message.
6. GitHub: a `workflow_dispatch` dry run produces 5 archives. Download the Linux or macOS one and
   repeat the demo start. The real release follows with tag `3.0.0` only when the user asks.

## Phase status

### Phase A1 — Interfaces, domain errors, config, contracts
- **Status:** done
- **Started:** 2026-11-07 15:16
- **Ended:** 2026-11-07 15:24

### Phase A2 — MySQL repositories + DI: accounts, transactions, categories, tax, settings
- **Status:** done
- **Started:** 2026-11-07 15:24
- **Ended:** 2026-11-07 15:30

### Phase A3 — MySQL repositories + DI: app-user, bank connections, sync
- **Status:** done
- **Started:** 2026-11-07 15:24
- **Ended:** 2026-11-07 15:34

### Phase B1 — Story-driven demo data generator
- **Status:** done
- **Started:** 2026-11-07 15:18
- **Ended:** 2026-11-07 18:18

### Phase B2 — Demo repositories
- **Status:** done
- **Started:** 2026-11-07 15:24
- **Ended:** 2026-11-07 15:34

### Phase C1 — Launcher package
- **Status:** done
- **Started:** 2026-11-07 15:18
- **Ended:** 2026-11-07 15:23

### Phase D1 — Frontend demo badge and read-only database tab
- **Status:** done
- **Started:** 2026-11-07 15:18
- **Ended:** 2026-11-07 15:25

### Phase A4 — Server wiring by DATA_SOURCE
- **Status:** done
- **Started:** 2026-11-07 15:34
- **Ended:** 2026-11-07 15:40

### Phase E1 — Release packaging and GitHub workflow
- **Status:** done
- **Started:** 2026-11-07 15:34
- **Ended:** 2026-11-07 15:37

### Phase F1 — Docs and config
- **Status:** done
- **Started:** 2026-11-07 15:40
- **Ended:** 2026-11-07 18:25

### Phase G1 — Quality gates and end-to-end verification
- **Status:** in progress
- **Started:** 2026-11-07 18:18
- **Ended:**

G1 notes (2026-11-07): full gates green. The frontend budget warning (774 kB vs 500 kB) predates
this plan (772.9 kB on 2.0.3). `NG0101` logs once appeared in the category edit dialog spec under
full parallel load and did not reproduce. The macOS arm64 archive was verified end to end in demo
and MariaDB mode with curl: Host/Origin 403, forged backend request 401, proxy not reachable on
the LAN. The launcher prompt now queues lines, because piped answers were lost. Still open: a
visual browser check (the Chrome extension was not connected) and a `workflow_dispatch` dry run
on GitHub (needs a push).
