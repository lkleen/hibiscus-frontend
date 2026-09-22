# hibiscus-frontend

An open-source web frontend for a [Hibiscus](https://www.willuhn.de/products/hibiscus/)
home-banking database (accounts, transactions, categories) backed by MariaDB.

> **This app is not safe to expose without an authenticating proxy in front of it.** It has no
> login of its own — it trusts identity asserted by an upstream forward-auth proxy (Authentik,
> Keycloak behind `oauth2-proxy`, Traefik forward-auth, …) and refuses every request without a
> matching shared secret, unconditionally, in every environment. See
> [Authentication](docs/architecture.md#authentication) for the full contract. No Compose file in
> this repo publishes the app's own port — only the fronting proxy does — by design: even a
> misconfiguration that republishes the app's port directly still can't be entered without both
> the identity header and the secret.

## Stack

- **Backend** (`packages/backend`): Node 22, Express, TypeScript, `mysql2` (no ORM).
- **Frontend** (`packages/frontend`): Angular, `@angular/cdk` (no Angular Material).
- pnpm workspaces + Turborepo.

See [docs/architecture.md](docs/architecture.md) for the data model, API, and auth contract in
full.

## Local development

Prerequisites: Node 22 (`.nvmrc`), pnpm, Docker.

```bash
pnpm install       # installs all workspace deps, wires up git hooks
pnpm start:local   # see below
```

`pnpm start:local` (`scripts/start-local.sh`) handles everything for a first run:

- generates `.env.dev.local` (gitignored) from `.env.example`, with fresh random secrets —
  including `INTERNAL_PROXY_SECRET` — instead of the placeholder values
- starts the local MariaDB container (`docker-compose.dev.yml`)
- starts the backend and frontend dev servers, with the frontend's dev proxy
  (`packages/frontend/proxy.config.mjs`) automatically satisfying the auth contract so there's
  no login step to click through locally (see
  [docs/architecture.md#authentication](docs/architecture.md#authentication) for why this
  doesn't weaken the production guarantee — it's the same check, unconditionally, just fed real
  values by the dev tooling instead of a real proxy)

On a fresh database, import your own Hibiscus data dump once (never commit it — `*.sql` is
gitignored):

```bash
set -a; source .env.dev.local; set +a
mysql -h 127.0.0.1 -u root -p"$DB_ROOT_PASSWORD" "$DB_NAME" < /path/to/your-dump.sql
```

Press <kbd>Ctrl+C</kbd> to stop the frontend/backend; you'll be asked whether to also stop the
database container (its data persists in a named volume either way).

## Docker

```bash
docker build -t hibiscus-frontend .
```

The image serves both the API and the built frontend on a single port (`3000`) and expects to
sit behind a forward-auth proxy on an internal Docker network — see below for a runnable
reference, and `.env.example` for the full list of required configuration.

## Trying the auth contract with a real IdP

`docker-compose.auth-demo.yml` stands up Keycloak + `oauth2-proxy` + Caddy in front of this app
and proves the forward-auth contract end to end with a real login — a fully open-source
combination you can run without any account or external service. **Demo credentials and
secrets only** — regenerate everything before using any of this for real.

```bash
export DB_HOST=demo DB_PORT=3306 DB_NAME=demo DB_USER=demo DB_PASSWORD=demo   # unused by /api/me
export INTERNAL_PROXY_SECRET=$(openssl rand -hex 32)
docker compose -f docker-compose.auth-demo.yml up -d --build
```

Give Keycloak ~15–20s to finish importing the demo realm, then open
<http://localhost:8080/> — you'll be redirected to Keycloak's login page
(`http://localhost:8090`). Sign in with the demo account: **username `demo`, password `demo`**.
You'll land back on the app, authenticated, with `GET /api/me` reporting `demo@example.com`.

Two things worth checking directly, since they're the actual point of this demo:

- `docker port hibiscus-frontend-app-1` prints nothing — the app has no published port; only
  `caddy` does.
- `curl http://localhost:8080/` with no cookies returns a redirect to Keycloak, never the app,
  and forging headers directly against the app's own container (e.g. via `docker exec` into
  another container on `hibiscus_auth_demo_internal`) still gets rejected without the exact
  `INTERNAL_PROXY_SECRET` value.

Authentik's own forward-auth outpost satisfies the identical contract
(`AUTH_HEADER_USER`/`ALLOWED_USERS`/`INTERNAL_PROXY_SECRET`) — this demo just needed one
concrete, easy-to-run IdP to be a working example rather than a description.

Tear down with `docker compose -f docker-compose.auth-demo.yml down -v`.

## License

[GPL-3.0](LICENSE).
