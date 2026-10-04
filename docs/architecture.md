# Architecture

## Packages

- `packages/backend` — Node 22 + Express + TypeScript. Owns the MariaDB connection (`mysql2`,
  no ORM) and the forward-auth middleware. Serves the JSON API under `/api/*` and, in the
  production Docker image, the built frontend as static files.
- `packages/frontend` — Angular (CDK only, no Material) single-page app that consumes the API.
  All tables use the generic `<app-data-table>` component (`app/shared/components/data-table/`),
  which wraps PrimeNG's `p-table` with an ag-Grid-shaped API: raw rows, and column-owned lambdas
  (`valueGetter`, `valueFormatter`, `comparator`, `filterValueGetter`, `getQuickFilterText`)
  evaluated live, never materialised onto rows. Column sizing via `autoSizeStrategy`
  (`fitGridWidth` / `fitProvidedWidth` / `fitCellContents`) and drag-resize (default on, 'expand'
  mode) are done in pure CSS. Columns can be reordered by dragging their header (default on,
  `columnReorder` option), order kept for the session only. The component offers an ag-Grid-style
  `externalFilter` input (a caller-supplied predicate applied before table filters, resetting to
  page 1 on change) and two projection slots for additional filters: `[appDataTableToolbarStart]`
  before the search field and `[appDataTableToolbar]` after it. Features are added to the component, never implemented per table. Theming goes
  through the CSS bridge in `styles/_primeng-table.scss`. The component optionally renders a tree
  via the `treeData` option (self-referencing parent-id style, built by `buildTree`); it renders
  PrimeNG's `p-treetable` instead of `p-table` and shares all column models and lambdas. Trees are
  fully expanded by default with expand-all/collapse-all controls; the quick filter is lenient
  (keeping ancestors of matches), sorting and resizing work, and pagination is not available.
- `packages/shared` — types-only API contracts, imported by both packages (see
  [Shared contracts](#shared-contracts)). No runtime code and no build step.

## Data model

Backed by a MariaDB database matching the schema Hibiscus (the desktop Jameica/Hibiscus
home-banking client) creates via its own `mysql-create.sql`. This repo never owns or migrates
that schema — it only reads/writes against tables that already exist, with one exception: the
app-owned `hf_user_setting` table for per-user settings (see below).

Tables this app uses:

| Table       | Purpose                                                                 |
|-------------|--------------------------------------------------------------------------|
| `konto`     | Bank accounts — name, IBAN/BIC, currency, current balance                |
| `umsatz`    | Transactions/bookings — amount, purpose text, counterparty, date, FKs to `konto` and `umsatztyp` |
| `umsatztyp` | Categories — self-referencing tree via `parent_id`, has a `color` column |
| `hf_user_setting` | Per-user app settings; keyed by `(user_name, setting_key)` with JSON value; created at startup |

Not used by v1 (future work): `dauerauftrag`/`sepadauerauftrag` (standing orders),
`lastschrift`/`sepalastschrift` (direct debits), `kontoauszug` (statements), `protokoll`,
`reminder`, `systemnachricht`, `empfaenger` (payee address book).

Write scope is limited to per-user settings (date range presets) in `hf_user_setting`.
Transactions and categories are read-only (`GET /api/transactions`, `GET /api/categories`).
It does not edit bank-imported transaction fields (amount, date, counterparty) — those are
synced from the bank by the desktop client and are not this app's data to change.

## API (v1)

All routes are under `/api` and require authentication (see below) except `/api/me`, which
itself requires authentication too — there is no unauthenticated route in this app at all.

| Method & path                         | Purpose                                    |
|----------------------------------------|---------------------------------------------|
| `GET /api/me`                          | Echoes the authenticated identity           |
| `GET /api/accounts`                    | List `konto` rows, as stored (`AccountRow`) |
| `GET /api/transactions`                | Every `umsatz` row, as stored, unfiltered and unpaged — columnar (`TransactionsResponse`) |
| `GET /api/categories`                  | List `umsatztyp` rows, as stored (`CategoryRow`) |
| `GET /api/settings/date-presets`       | User's date presets; defaults if not stored |
| `PUT /api/settings/date-presets`       | Save whole preset list (zod-validated); answers `204` |
| `DELETE /api/settings/date-presets`    | Restore defaults; answers `204`            |

### Shared contracts

`packages/shared` declares the API request/response types once
(`@hibiscus-frontend/shared/contracts/transactions`, `…/accounts`, `…/categories`); the backend
routes and repositories and the frontend `ApiService` both import them, so the two sides cannot
drift apart. They are authored as `.d.ts` files, which TypeScript type-checks but never emits, so
the package needs no build step and the backend's `dist/` layout is unchanged.

`GET /api/categories` returns `CategoryRow` rows: the `umsatztyp` columns as stored. The `color`
column is stored as `"r,g,b"` (comma-separated bytes, as Hibiscus writes it); rows edited by this
app's former categories page may hold `#rrggbb` instead. The colour is displayed only when `customcolor = 1`. The frontend
converts both formats to CSS via `toCssColor()` (`core/utils/category-color.ts`).

`GET /api/transactions` returns the selected `umsatz` columns exactly as the DB has them
(`TransactionRow`: `konto_id`, `empfaenger_name`, `betrag`, `zweck`, `umsatztyp_id`, …). To keep
the payload small it is columnar (`TransactionsResponse`): the column names once in `columns`, then
each row as an array of its values in that order (`mysql2`'s `rowsAsArray`, so the backend does no
per-row mapping; about 40% smaller than an array of objects). `ApiService.getTransactions()` turns
it back into `TransactionRow` objects, so everything past the service sees plain rows. The
backend neither renames nor derives anything — the DB layout is fixed for compatibility with the
desktop client, and the API mirrors it one-to-one. The UI never displays a column name: every
visible label (column headers included) comes from the translations.

`GET /api/accounts` does the same for `konto` (`AccountRow`). Note that `konto.name` is the account
*holder* (the same on every account); an account's own label is `bezeichnung`.

The transactions table shows every meaningful `umsatz` column as stored — the ids are the only
values it resolves: `konto_id` to the account's holder, BIC, account number and label (four plain
columns looked up from `/api/accounts`). `umsatztyp_id` is served but not shown. What the text
columns contain differs by account and over time (bank/Hibiscus import formats), so the table does not interpret them.

### User settings

Per-user settings are keyed by the forward-auth identity and stored in `hf_user_setting`. The
shared contract `@hibiscus-frontend/shared/contracts/user-settings` defines the setting types;
date presets are the first (relative units like "current month" or fixed date ranges, each named
or auto-generated, the first preset auto-selected on page load). Defaults live only in the backend
(`DEFAULT_DATE_PRESETS`); the user is never "no presets", they always have at least the defaults.
Reads and writes go through `DatePresetService`, which loads presets once at app startup, queues
all writes through a single serial channel (so the server receives them in order), and only
surfaces confirmed state to the UI (unsaved changes are not displayed).

### Transactions table

The table loads **every** `umsatz` row in one request (about 10,000 rows, under 3 MB of columnar
JSON, about 530 KB on the wire — the backend gzips every response via the `compression`
middleware) as raw `TransactionRow` objects. The `<app-data-table>` component handles all client-side sorting
(newest booking first by default), column filtering (text, numeric and date per column), global
search, and pagination (20 rows per page by default). The backend returns all rows `ORDER BY id`
(deterministic only); it does not sort, filter or page. Column definitions include `valueGetter`
lambdas for resolving `konto_id` to account details (holder, BIC, account number, label); all
values are computed live, not materialised onto rows.
The table uses `autoSizeStrategy: fitCellContents` with an 82rem minimum width, so cells are
single-line and the table scrolls horizontally. A `<app-date-range-filter>` in the table's
toolbar filters on `datum` (booking date), inclusive; it starts on the user's first date preset
and persists within the session only. Its ◀/▶ buttons jump to the previous/next whole calendar
period (`adjacentPeriod()` in `core/utils/date-range.ts`) of a step unit chosen next to them
(day, week, month, quarter, year): ◀ steps from `from`, ▶ from `to`, an open end falls back to the
other end, and "all dates" to today. The step unit follows the selected relative preset's unit and
is otherwise session-only state of the filter.
Left of the search field, an `<app-account-filter>` dropdown lists every account (label and IBAN)
with a checkbox; only transactions of checked accounts are shown. Its state is the set of
*unchecked* account ids (session only), so every account — including one that loads late — starts
checked. Both filters are combined into the table's single `externalFilter` predicate.
See the `transactions-table` skill for column definitions.

### Categories page

A read-only `/:locale/categories` page in the navigation shows the entire `umsatztyp` tree as a
table with expand-all/collapse-all controls. Every column is rendered as stored: `type` is
translated (`0` = expense, `1` = income, `2` or `NULL` = any), `konto_id` is resolved to the
account label via `/api/accounts`, and the `flags` column's bit 1 (`FLAG_SKIP_REPORTS = 1`)
indicates "skip in reports". The `color` column is rendered via `toCssColor`. Category editing is planned as a later step.

## Authentication

This app never implements its own login, password storage, or session/JWT minting. It
**consumes** identity asserted by an upstream forward-auth proxy (Authentik, Keycloak behind
`oauth2-proxy`, Traefik forward-auth — the contract is generic and works with any of them).

The guarantee — **not accessible without the identity provider, even under misconfiguration** —
comes from two independent, always-on layers:

1. **Network isolation.** No Compose file in this repo ever publishes the app container's port.
   Only the fronting proxy service publishes a port; the app sits on an internal Docker network
   reachable only from that proxy.
2. **Shared secret, checked unconditionally.** The backend requires two things on every request,
   with no environment flag or mode that skips the check:
   - a configurable identity header (env `AUTH_HEADER_USER`, e.g. `X-Forwarded-User`)
   - a matching value in a second header carrying a pre-shared secret (env
     `INTERNAL_PROXY_SECRET`, compared in constant time)

   Missing or mismatched → `401`. A request whose identity header value isn't in the required
   `ALLOWED_USERS` allowlist (comma-separated usernames/emails) → `403`.

There is deliberately no `APP_ENV`-gated bypass anywhere near this check — an earlier draft of
this design trusted a plain dev-mode header with no secret, which would have been silently
exploitable if that mode's port were ever exposed by mistake. The fix was to delete that branch,
not harden it: the same check runs unconditionally in every environment.

Local, non-Docker development (`pnpm start:local`) gets its convenience from *outside* the app:
`scripts/start-local.sh` generates a random `INTERNAL_PROXY_SECRET` into a gitignored
`.env.dev.local` on first run, and the Angular dev server's `proxy.config.mjs` injects that
secret plus a fixed identity header on every proxied request — exactly mimicking what a real
proxy sends. The backend cannot tell dev and production apart.

`docker-compose.auth-demo.yml` demonstrates the full contract end-to-end: Caddy is the one
published-port edge, using its `forward_auth` directive against `oauth2-proxy` (which handles
the actual Keycloak OIDC login) and copying the authenticated identity into the app's identity
header, then adding the shared secret itself via `header_up` before proxying to the
unpublished `app` service. This has been run and verified end-to-end, including a real Keycloak
login (see README.md) — not just written and assumed to work. Authentik's own forward-auth
outpost satisfies the identical `AUTH_HEADER_USER`/`ALLOWED_USERS`/`INTERNAL_PROXY_SECRET`
contract; the demo just needed one concrete, easy-to-run IdP to be a working example.

Three real bugs were caught by actually running this demo rather than trusting the design on
paper, all fixed in `auth-demo/Caddyfile` / `docker-compose.auth-demo.yml`:
- A bare top-level `header` directive sets *response* headers, not the upstream request header —
  it was leaking the shared secret back to the client. Fixed with `header_up` inside
  `reverse_proxy`.
- Caddy reorders directives by a fixed precedence list regardless of file order, so
  `forward_auth` ran before the path-matched `reverse_proxy /oauth2/*`, gating oauth2-proxy's
  own sign-in page behind itself in an infinite redirect loop. Fixed by wrapping the three
  directives in an explicit `route { }` block, which runs them in the order written.
- Keycloak's discovery document by default advertises whatever address it was reached on, which
  is `keycloak:8080` (internal-only) for oauth2-proxy's own backend calls — unreachable by a
  browser. Fixed with `KC_HOSTNAME` (browser-facing endpoints) plus
  `KC_HOSTNAME_BACKCHANNEL_DYNAMIC` (keeps backend-to-backend endpoints on the internal
  address) and oauth2-proxy's `--insecure-oidc-skip-issuer-verification` (the strict issuer
  match otherwise rejects the resulting mismatch between the two).

TLS termination is the proxy's responsibility; this app only ever speaks plain HTTP behind it.

## Internationalization

The frontend ships two locales, `en` and `de`. There is no backend involvement: the API sends no
localized text, and database content (account, category and payee names, transaction purposes) is
user data and is shown as-is.

- **URL is the source of truth.** Every route is `/:locale/...`; `LocaleService` mirrors the first
  URL segment into a `locale` signal and sets `<html lang>`. Bare or unsupported-locale URLs
  redirect to `/{preferred}/accounts`, where preferred is `de` if `navigator.language` starts with
  `de`, else `en`. The locale is not persisted separately, so the URL alone decides it.
- **Dictionaries** live in `packages/frontend/src/i18n/{en,de}.json` and are bundled (imported as
  JSON, not fetched). `en.json` defines the `TranslationKey` type and `de.json` must satisfy
  `Record<TranslationKey, string>`, so a key missing in either file is a compile error. A spec also
  checks that placeholders match across locales.
- **`TranslationService.t(key, params?)`** resolves `{name}` placeholders and throws on a missing
  param. It reads the locale signal, so template calls update on language switch.
- **Number formatting** passes the locale explicitly to `DecimalPipe` (`LOCALE_ID` is fixed at
  bootstrap and cannot follow a URL change); German locale data is registered in `app.config.ts`.
  Dates stay ISO (`yyyy-MM-dd`).
- **Language switcher** is a submenu in the user menu, next to the theme submenu. It swaps the
  locale segment and keeps path, query params and fragment.

Adding a locale: add it to `SUPPORTED_LOCALES` (`core/models/locale.model.ts`), create its
dictionary, register it in `DICTIONARIES` (`core/models/translation.model.ts`), register its Angular
locale data in `app.config.ts`, and add a `locale.<code>` label to every dictionary.

## Settings

Per-user settings are accessed via a route-based tab interface at `/:locale/settings/<tab>`,
with all tabs defined in a single source (`SETTINGS_TABS` in `settings-tabs.ts`). The route
structure is: root shell component loads the active tab child route lazily. The first tab is
the default. Settings are reachable from the user menu. Currently implemented: date range
presets (see User settings above).

## Local development

See the root `README.md` for the full setup (including importing a data dump). In short:
`pnpm start:local` (`scripts/start-local.sh`) starts the local MariaDB container and both
packages together, with the auth contract satisfied automatically (see above) — no manual
token setup needed.
