# Architecture

## Packages

- `packages/backend` — Node 22 + Express + TypeScript. Owns the MariaDB connection (`mysql2`,
  no ORM) and the forward-auth middleware. Serves the JSON API under `/api/*` and, in the
  production Docker image, the built frontend as static files.
- `packages/frontend` — Angular (CDK only, no Material) single-page app that consumes the API.
  Every table goes through `BaseTableComponent` (`core/components/base-table`), an ag-Grid
  Community grid that carries the project theme; features use it like `<ag-grid-angular>` and
  supply their own column definitions and cell renderers.
- `packages/shared` — types-only API contracts, imported by both packages (see
  [Shared contracts](#shared-contracts)). No runtime code and no build step.

## Data model

Backed by a MariaDB database matching the schema Hibiscus (the desktop Jameica/Hibiscus
home-banking client) creates via its own `mysql-create.sql`. This repo never owns or migrates
that schema — it only reads/writes against tables that already exist.

Tables this app uses:

| Table       | Purpose                                                                 |
|-------------|--------------------------------------------------------------------------|
| `konto`     | Bank accounts — name, IBAN/BIC, currency, current balance                |
| `umsatz`    | Transactions/bookings — amount, purpose text, counterparty, date, FKs to `konto` and `umsatztyp` |
| `umsatztyp` | Categories — self-referencing tree via `parent_id`, has a `color` column |
| `empfaenger`| Payee/counterparty address book                                          |

Not used by v1 (future work): `dauerauftrag`/`sepadauerauftrag` (standing orders),
`lastschrift`/`sepalastschrift` (direct debits), `kontoauszug` (statements), `protokoll`,
`reminder`, `systemnachricht`.

Write scope is deliberately narrow: this app can create/rename/delete/re-parent categories and
change which category a transaction belongs to (`umsatz.umsatztyp_id`). It does not edit
bank-imported transaction fields (amount, date, counterparty) — those are synced from the bank
by the desktop client and are not this app's data to change.

## API (v1)

All routes are under `/api` and require authentication (see below) except `/api/me`, which
itself requires authentication too — there is no unauthenticated route in this app at all.

| Method & path                         | Purpose                                    |
|----------------------------------------|---------------------------------------------|
| `GET /api/me`                          | Echoes the authenticated identity           |
| `GET /api/accounts`                    | List `konto` rows, as stored (`AccountRow`) |
| `GET /api/transactions`                | Every `umsatz` row, as stored (`TransactionRow[]`), unfiltered and unpaged |
| `PATCH /api/transactions/:id`          | Recategorize — body: `{ categoryId }`; answers `204` |
| `GET /api/categories`                  | `umsatztyp` tree                           |
| `POST /api/categories`                 | Create a category                          |
| `PATCH /api/categories/:id`            | Rename / re-parent / recolor a category    |
| `DELETE /api/categories/:id`           | Delete a category                          |
| `GET /api/payees`                      | List/search `empfaenger`                   |

### Shared contracts

`packages/shared` declares the API request/response types once
(`@hibiscus-frontend/shared/contracts/transactions`, `…/accounts`); the backend routes and
repositories and the frontend `ApiService` both import them, so the two sides cannot drift apart.
They are authored as `.d.ts` files, which TypeScript type-checks but never emits, so the package
needs no build step and the backend's `dist/` layout is unchanged.

`GET /api/transactions` returns the selected `umsatz` columns exactly as the DB has them
(`TransactionRow`: `konto_id`, `empfaenger_name`, `betrag`, `zweck`, `umsatztyp_id`, …). The
backend neither renames nor derives anything — the DB layout is fixed for compatibility with the
desktop client, and the API mirrors it one-to-one. The UI never displays a column name: every
visible label (column headers included) comes from the translations.

`GET /api/accounts` does the same for `konto` (`AccountRow`). Note that `konto.name` is the account
*holder* (the same on every account); an account's own label is `bezeichnung`.

The transactions grid shows every meaningful `umsatz` column as stored — the ids are the only
values it resolves: `konto_id` to the account's holder, BIC, account number and label (four plain
columns looked up from `/api/accounts`) and `umsatztyp_id` to the category. What the text columns contain differs by account and over
time (bank/Hibiscus import formats), so the grid does not interpret them.

### Transactions table

The table loads **every** `umsatz` row in one request (about 10,000 rows, a few MB of JSON) and
ag-Grid's client-side row model does the rest: sorting (newest booking first by default), column
filters (text, number and date filters with floating filters), the quick filter over all columns
(the search field), and pagination (20 rows per page, built-in pager). The backend never sorts,
filters or pages for the table; `ORDER BY id` only makes the response deterministic. ag-Grid
Community only — no Enterprise features, so no row grouping. The grid's own texts (filter menus,
pager) are translated through the `grid.*` dictionary keys (`core/utils/grid-locale-text.ts`).

A category change is saved with `PATCH /api/transactions/:id` and then applied to the row the grid
holds (`applyTransaction`), which keeps the user's page, sorting and filters.

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

## Local development

See the root `README.md` for the full setup (including importing a data dump). In short:
`pnpm start:local` (`scripts/start-local.sh`) starts the local MariaDB container and both
packages together, with the auth contract satisfied automatically (see above) — no manual
token setup needed.
