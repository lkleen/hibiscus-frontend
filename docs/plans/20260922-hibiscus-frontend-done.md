# Hibiscus Frontend — initial build

Status: **done** — approved and fully implemented 2026-09-22.

## Context

Hibiscus (the desktop Jameica/Hibiscus home-banking client) has been migrated onto a MariaDB
backend on `ubuntu-server`, but there was no web frontend — only the desktop app and raw
`mysql` access. This repo is a new, standalone, open-source web frontend for that data, delivered
as a Docker container. Wiring it into the `ubuntu-server` stack (Caddy, Authentik, compose
profile) is explicitly out of scope for this build — that happens later, in the private
`ubuntu-server` repo.

Decided with the user during planning:
- **Scope**: full read-write against the account/transaction/category data.
- **License**: GPL-3.0.
- **Server integration**: not part of this repo's work.
- **Public-repo hygiene**: no home-server-specific hostnames, topology, or IdP naming anywhere
  in this repo — the auth contract is generic (works with Authentik, Keycloak, or anything else
  that speaks forward-auth).
- **No Angular Material** — CDK plus a custom token/component system only.
- **Authentication/authorization is in scope for v1**, but *only* as a consumer of an external
  IdP via the forward-auth pattern — this app never implements its own login, password storage,
  or session/JWT minting.

## Stack & conventions

Personal project → follows `~/repositories/claude-config` (not `omniverse-copilot-config`,
which is client-only IP for the Omniverse stack). `ubuntu-server/apps/dashboard` is a working
instance of this exact pattern in the same repo family and is the template to mirror:

- pnpm workspaces + Turborepo monorepo, `packages/backend` + `packages/frontend`.
- Backend: Node 22, Express, TypeScript strict, `zod` for env/secret validation, `mysql2`
  (no ORM — YAGNI/KISS for ~5 tables).
- Frontend: Angular + `@angular/cdk` only, custom design tokens, no Material.
- Single Docker image: multi-stage build, Express serves the API and the built Angular static
  files on one port.

## Data model

From the Hibiscus schema (already exists on the DB side — this app does not own or migrate it):

| Table       | Purpose                                                                            |
|-------------|--------------------------------------------------------------------------------------|
| `konto`     | Bank accounts                                                                       |
| `umsatz`    | Transactions/bookings, FK → `konto` and `umsatztyp`                                |
| `umsatztyp` | Categories, self-referencing tree via `parent_id`, has `color`                     |
| `empfaenger`| Payee/counterparty address book                                                     |

Deferred (documented as future work, not built now): `dauerauftrag`/`sepadauerauftrag`,
`lastschrift`/`sepalastschrift`, `kontoauszug`, `protokoll`, `reminder`, `systemnachricht`.

Write scope: category CRUD and re-categorizing a transaction. Bank-imported fields (amount,
date, counterparty) are read-only in this app.

## Authentication & authorization

Full detail lives in [docs/architecture.md](../architecture.md#authentication) and is kept in
sync there as the source of truth; summary:

- The backend trusts a configurable identity header (`AUTH_HEADER_USER`) **only** in
  combination with a matching pre-shared secret header (`INTERNAL_PROXY_SECRET`), checked
  unconditionally on every request, in every environment — no bypass flag exists anywhere.
- No Compose file in this repo ever publishes the app container's port; only a fronting proxy
  does. This is the primary defense; the shared secret is defense in depth for the same
  boundary.
- Authorization is an explicit `ALLOWED_USERS` allowlist (comma-separated), required at startup.
- `docker-compose.auth-demo.yml` demonstrates the contract with Keycloak + `oauth2-proxy`;
  Authentik's forward-auth outpost satisfies the same contract.
- Local dev (`pnpm start:local`) gets the same contract satisfied automatically via a generated
  `.env.dev.local` secret and the Angular dev-server proxy injecting matching headers — there is
  no weaker dev-only code path in the app.

This design was corrected twice during planning, both times by the user: first to remove a
built-in login/JWT the app would have owned itself (replaced with "consume upstream auth"),
then to remove an `APP_ENV`-gated bypass that would have been passwordless if its port were ever
exposed by mistake (replaced with the always-on, environment-blind check above).

## v1 features

1. Accounts — list with balances.
2. Transactions — paginated, filterable (account, date range, category, free text).
3. Categories — tree view, create/rename/delete/re-parent.
4. Recategorize a transaction.
5. Payees — list/search.
6. Forward-auth gate on every route from the first commit.

## Phases

### Phase A — Repo scaffold
- **Status:** done
- **Started:** 2026-09-22 13:20
- **Ended:** 2026-09-22 13:35

`git init`, LICENSE (GPL-3.0, official text), `.gitignore`, `CLAUDE.md` (with
`@../claude-config/*` imports and the no-Material / auth-contract rules called out explicitly),
`docs/architecture.md`, this plan file, root `package.json`/`turbo.json`/`pnpm-workspace.yaml`/
`.nvmrc`/`.prettierrc`/`.githooks/pre-push`. Skills linked from `claude-config` via
`pnpm run link-skills`. No `agents/` exist in `claude-config` (only in the unrelated,
client-only `omniverse-copilot-config`), so nothing to link there.

### Phase B — Backend package
- **Status:** done
- **Started:** 2026-09-22 13:23
- **Ended:** 2026-09-22 13:40

Built by a Sonnet subagent per the plan, then independently re-verified (typecheck/lint/test/
format/build all rerun directly, not just trusted from the agent's report) and extended
centrally: static-frontend serving + SPA fallback + a proper `/api/*` 404 (so the SPA catch-all
can't mask a real API 404) added to `server.ts`; a `dist/**/*.spec.js` vs Vitest test-discovery
bug found and fixed (`vitest.config.ts` + a separate `tsconfig.build.json` that excludes specs
from the production build). Express server, `zod`-validated config (`DB_*`, `PORT`,
`AUTH_HEADER_USER`, `ALLOWED_USERS`, `INTERNAL_PROXY_SECRET`), `mysql2` pool, typed repositories
for `konto`/`umsatz`/`umsatztyp`/`empfaenger`, forward-auth middleware + `GET /api/me`, REST
routes per `docs/architecture.md`, Vitest tests for repositories and the auth middleware
(including a test asserting no code path returns 2xx without both header and secret).

### Phase C — Frontend package
- **Status:** done
- **Started:** 2026-09-22 13:23
- **Ended:** 2026-09-22 13:38

Built by a Sonnet subagent per the plan, in parallel with Phase B (disjoint file sets), then
independently re-verified directly. Angular app (CDK + custom tokens, no Material): accounts
list, transactions list (filters + pagination, inline recategorize via a CDK-overlay category
picker), category tree (CRUD, cycle-safe re-parenting), payee list, `/api/me` display. No
login/guard/interceptor code — the proxy gates the whole origin, not the SPA.

### Phase D — Local dev convenience
- **Status:** done
- **Started:** 2026-09-22 13:44
- **Ended:** 2026-09-22 13:44

`scripts/start-local.sh`: generates `.env.dev.local` with random `DB_PASSWORD`/
`DB_ROOT_PASSWORD`/`INTERNAL_PROXY_SECRET` on first run, brings up `docker-compose.dev.yml`,
runs both packages, prompts on exit whether to also stop the database container.
`packages/frontend/proxy.config.mjs` (the frontend agent built this as part of Phase C, ahead of
this phase landing, since it's a frontend-side file) injects that secret + a fixed identity
header on every proxied request.

### Phase E — Docker packaging
- **Status:** done
- **Started:** 2026-09-22 13:44
- **Ended:** 2026-09-22 14:00

Multi-stage `Dockerfile` (mirrors `apps/dashboard`, verified with a real `docker build`),
`docker-compose.dev.yml` (MariaDB only, no app/proxy services), `docker-compose.auth-demo.yml` +
`auth-demo/Caddyfile` + `auth-demo/keycloak-realm.json` (Keycloak + `oauth2-proxy` + Caddy +
app, app has no published port), `.env.example`, `.dockerignore`.

### Phase F — Docs
- **Status:** done
- **Started:** 2026-09-22 13:53
- **Ended:** 2026-09-22 14:05

`README.md`: setup (including importing a dump into the dev DB via `start-local.sh`), Docker
usage, a verified auth-demo walkthrough with real login steps, and the
not-safe-to-expose-without-a-proxy warning. `docs/architecture.md` kept in sync throughout,
including a record of the three real bugs the auth-demo run caught (see below).

### Phase G — Verification
- **Status:** done
- **Started:** 2026-09-22 13:40
- **Ended:** 2026-09-22 14:07

All done for real, not assumed from the subagents' own reports:
- `pnpm format:fix && pnpm lint && pnpm typecheck && pnpm test && pnpm build` from the repo
  root: all green (backend 15 tests, frontend 14 tests).
- `docker build`: succeeds; image serves both API and SPA on port 3000.
- Misconfiguration test: a standalone `docker run -p` of the built image, hit directly with no
  header, a wrong secret, and a non-allowlisted user — all correctly `401`/`403`; only the
  correct header+secret+allowlist combination returns `200`.
- Full `docker-compose.auth-demo.yml` run: real Keycloak login (`demo`/`demo`) through
  `oauth2-proxy` and Caddy reached the app authenticated as `demo@example.com`; the app
  container has no published port at any point; three real bugs found and fixed along the way
  (see `docs/architecture.md#authentication`).
- Live DB round-trip: a minimal synthetic schema (matching the real column names, no real data)
  loaded into `docker-compose.dev.yml`'s MariaDB; the built backend run directly against it —
  accounts/categories/payees/transactions all read correctly, and a `PATCH
  /api/transactions/:id` recategorize (including to `null`) was confirmed to persist by
  re-fetching. Found one minor, non-blocking scope gap while doing this: the `GET
  /api/transactions` route's `categoryId` query only accepts a positive integer, so filtering
  the list for "uncategorized" isn't reachable from the API even though the repository layer
  supports it — consistent with the frontend, which also doesn't currently expose that filter
  option, so nothing is broken, just an unimplemented filter worth a follow-up if wanted.

## Execution approach

Implementation delegated to `Agent` calls with `model: "sonnet"`, split along package
boundaries (backend / frontend) so no two agents touch the same files. Docker packaging, docs,
and verification done centrally afterward since they depend on both packages' finished
contracts.
