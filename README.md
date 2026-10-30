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

See [docs/architecture.md](docs/architecture.md) for the data model, API, auth contract and the
[multi-user model](docs/architecture.md#multi-user) in full.

## Setting up hibiscus-frontend

One deployment serves several people. Everyone signs in through your identity provider, connects
**their own Hibiscus database** in the web UI and keeps **their own encryption key** for their
bank PINs. The setup has two parts: the operator runs the app once (1), then every person
prepares a database (2) and goes through the first login (3).

### 1. Operator setup

**An authenticating proxy is required.** The app has no login of its own. A forward-auth proxy
(Authentik, Keycloak behind `oauth2-proxy`, Traefik forward-auth, …) authenticates the user and
adds two headers to every request it passes on; the app refuses everything else. TLS ends at the
proxy. Never publish the app's own port. See
[Authentication](docs/architecture.md#authentication).

Configuration is entirely environment variables, and every one is required (a missing or invalid
value stops the app at startup):

| Variable                                                  | What it is                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_HEADER_USER`                                        | Name of the header your proxy fills with the signed-in username, e.g. `X-Forwarded-User`. This username is the only identity the app knows; it stores one small record per username.                                                                                                           |
| `ALLOWED_USERS`                                           | Comma-separated usernames (or emails) that may use the app, exactly as the proxy asserts them. Anyone else gets `403`.                                                                                                                                                                         |
| `INTERNAL_PROXY_SECRET`                                   | Pre-shared secret your proxy must send in the fixed header `X-Internal-Auth-Secret`. Use a long random value: `openssl rand -hex 32`.                                                                                                                                                          |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | The **app database**. It holds one table, `hf_app_user` (each user's database settings and key state), created at startup. It is not a Hibiscus database; the users' Hibiscus databases are configured in the web UI. A dedicated database and user are recommended.                           |
| `ALLOWED_DB_HOSTS`                                        | Comma-separated database hosts users may connect to, as `host` or `host:port` (e.g. `hibiscus-db,db.internal:3307`). A host without a port allows every port. Users pick from this list in the UI; the check runs when they save and before every connection.                                  |
| `BANK_CREDENTIALS_KEY`                                    | The **server key**: base64 of exactly 32 bytes, generate it with `openssl rand -base64 32`. It encrypts the users' database passwords and, for users who chose "Store on the server", their keys. Keep a copy somewhere safe: losing it means every user enters their database password again. |
| `PORT`                                                    | Port the app listens on inside its container, e.g. `3000`.                                                                                                                                                                                                                                     |

`.env.example` lists all of them with local-development values.

**Run it.** Build the image (`docker build -t hibiscus-frontend .`) and put it on an internal
network that only your proxy shares. A trimmed Compose example, with the secrets in an env file:

```yaml
services:
  hibiscus-frontend:
    image: hibiscus-frontend
    restart: unless-stopped
    environment:
      DB_HOST: hibiscus-db
      DB_PORT: 3306
      DB_NAME: hibiscus_app
      DB_USER: hibiscus_app
      DB_PASSWORD: ${HF_DB_PASSWORD}
      PORT: 3000
      AUTH_HEADER_USER: X-Forwarded-User
      ALLOWED_USERS: anna@example.com,ben@example.com
      INTERNAL_PROXY_SECRET: ${HF_PROXY_SECRET}
      ALLOWED_DB_HOSTS: hibiscus-db
      BANK_CREDENTIALS_KEY: ${HF_SERVER_KEY}
    networks: [internal]
    # No `ports:` - only the proxy is reachable from outside.

  proxy: # your forward-auth proxy, e.g. Caddy + Authentik outpost
    # authenticates, sets X-Forwarded-User and X-Internal-Auth-Secret, forwards to
    # http://hibiscus-frontend:3000 and is the only service that publishes a port
    networks: [internal, edge]

networks:
  internal:
  edge:
```

`docker-compose.auth-demo.yml` is a complete runnable proxy setup (Keycloak + `oauth2-proxy` +
Caddy), see [below](#trying-the-auth-contract-with-a-real-idp).

**Outbound HTTPS.** The app itself talks to the banks (FinTS over HTTPS), so the container needs
outbound HTTPS to every bank endpoint your users add. It needs no inbound access besides the proxy.

### 2. Preparing a Hibiscus database for a user

Each person needs a MariaDB database the app can reach through a host on `ALLOWED_DB_HOSTS`:

1. Create the database and a user that may use only that database:

   ```sql
   CREATE DATABASE hibiscus_anna CHARACTER SET utf8 COLLATE utf8_general_ci;
   CREATE USER 'anna'@'%' IDENTIFIED BY 'a-strong-password';
   GRANT ALL PRIVILEGES ON hibiscus_anna.* TO 'anna'@'%';
   ```

2. Fill it with the Hibiscus schema. Either import the schema script from the Hibiscus
   distribution (`mysql-create.sql`) for a fresh start, or restore a dump of the existing
   Hibiscus database:

   ```bash
   mysql -h <host> -u anna -p hibiscus_anna < mysql-create.sql   # or: < your-dump.sql
   ```

   Never commit a dump (`*.sql` is gitignored).

3. Tell the person host, port, database name, user and password. The app adds its own `hf_*`
   tables (settings, tax sections, bank connections, sync runs) on the first connect; Hibiscus's
   tables are not changed apart from the transaction category and comment, and imported bank
   transactions.

### 3. First login per user

A user who signs in without a database lands on a setup page with three steps:

1. **Database.** Pick the host from the allowed list, enter port, database name, user and password
   and press "Test connection". It reports whether the connection works and whether the Hibiscus
   tables were found. Save.
   Every Hibiscus database can belong to **one user only**: saving a database another user
   already uses is refused.
2. **Key mode.** Choose how the server may handle the key that protects your bank PINs. You can
   change it later in Settings → Encryption key.

   | Mode                      | What it means                                                                                                                                                                                                                                                  |
   | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **Ask me every time**     | The key is never kept. No automatic sync; every "Sync now" asks for the key, which is dropped when the run (including waiting for a TAN) ends. Safest: nobody with the server or its backups can read your PINs.                                               |
   | **Keep in server memory** | You unlock once; the key stays in the server's RAM until you lock it, the server restarts or a new version is deployed. Syncs run while unlocked and pause after a restart until you unlock again. Someone who controls the running server could read the key. |
   | **Store on the server**   | The key is kept encrypted with the server key. Syncs always run, also after restarts. Whoever controls the server, or has the backups together with the server key, can decrypt your PINs.                                                                     |

3. **Encryption key.** "Generate" creates a random key and shows it **once**: save it in your
   password manager before you continue, it cannot be shown again. Or paste your own key (base64
   of 32 bytes). With the key lost, only "Reset key" helps, which deletes all stored PINs.

Afterwards Settings has two more tabs: **Database** (change the connection; an empty password
keeps the stored one; refused while a sync runs) and **Encryption key** (unlock/lock, change the
mode, change the key, reset the key).

### 4. Adding a bank connection

Settings → Bank connections → "Add connection": name, bank code (BLZ), FinTS URL (prefilled for
known banks), login name, PIN, sync interval. Saving asks for your key unless your mode keeps it
available. Then:

1. **Discover accounts.** Logs in at the bank and lists its accounts and TAN methods. If the bank
   asks for a TAN, a dialog opens.
2. **Map accounts.** Assign each bank account to one of your Hibiscus accounts (preselected by
   IBAN) and choose the TAN method (and medium). Only mapped, enabled accounts are synced.
3. **TANs.** A banner and a dialog ask for a TAN when a run needs one (typed, photo TAN, or
   approval in your banking app). An unanswered scheduled run pauses that connection until you
   press "Sync now".
4. **Sync now.** Available on the Accounts page, always. In "Ask me every time" mode (and in
   memory mode while locked) it asks for your key first. In memory mode the banner shows
   "Automatic sync paused" with an Unlock button while the key is locked.

### The FinTS product ID

FinTS banks only accept registered software (Deutsche Kreditwirtschaft,
[fints.org](https://www.fints.org)). hibiscus-frontend is a frontend for Hibiscus and works on its
database, so it sends **Hibiscus's official product ID**, taken from Hibiscus's `HBCI.java`, with
its own version (`FINTS_PRODUCT_VERSION`). Nothing to register when you run it. A fork that ships
as a different application registers its own and replaces `FINTS_PRODUCT_ID` in
`packages/backend/src/sync/fints-session.ts`.

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

The local MariaDB container's database `hibiscus` (`DB_*` in `.env.dev.local`) is both the **app
database** and, for the dev user, the usual Hibiscus database: `ALLOWED_DB_HOSTS` is set to the
same host. Open the app, complete the setup (see
[First login per user](#3-first-login-per-user)) with host `127.0.0.1` and the `DB_*` values, and
import your own Hibiscus data dump once (never commit it — `*.sql` is gitignored):

```bash
set -a; source .env.dev.local; set +a
mysql -h 127.0.0.1 -u root -p"$DB_ROOT_PASSWORD" "$DB_NAME" < /path/to/your-dump.sql
```

Press <kbd>Ctrl+C</kbd> to stop the frontend/backend; you'll be asked whether to also stop the
database container (its data persists in a named volume either way).

### Testing with a second user

The dev proxy (`packages/frontend/proxy.config.mjs`) signs every request in as
`local-dev@example.com`. To see how a second person's setup behaves, with their own database and
key:

1. Create a second, empty database on the dev MariaDB and import the Hibiscus schema into it:

   ```bash
   set -a; source .env.dev.local; set +a
   mysql -h 127.0.0.1 -u root -p"$DB_ROOT_PASSWORD" \
     -e "CREATE DATABASE hibiscus_user2; GRANT ALL ON hibiscus_user2.* TO '$DB_USER'@'%';"
   mysql -h 127.0.0.1 -u root -p"$DB_ROOT_PASSWORD" hibiscus_user2 < /path/to/mysql-create.sql
   ```

2. Allow the second user: in `.env.dev.local` set
   `ALLOWED_USERS=local-dev@example.com,second@example.com`. `ALLOWED_DB_HOSTS` already allows
   `127.0.0.1`.
3. Restart with the second identity, then go through the first-login setup with database
   `hibiscus_user2`:

   ```bash
   DEV_AUTH_USER=second@example.com pnpm start:local
   ```

   Restart without `DEV_AUTH_USER` to be the first user again. Each user only sees their own
   accounts. Try each key mode: in "Ask me every time", "Sync now" asks for the key and a wrong key
   keeps the dialog open; in "Keep in server memory", a backend restart locks the key again.

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
export INTERNAL_PROXY_SECRET=$(openssl rand -hex 32)
export BANK_CREDENTIALS_KEY=$(openssl rand -base64 32)
docker compose -f docker-compose.auth-demo.yml up -d --build
```

Give Keycloak ~15–20s to finish importing the demo realm, then open
<http://localhost:8080/> — you'll be redirected to Keycloak's login page
(`http://localhost:8090`). Sign in with the demo account: **username `demo`, password `demo`**.
You'll land back on the app, authenticated, with `GET /api/me` reporting `demo@example.com`, on
the setup page: the demo user has no Hibiscus database yet. The compose file brings a demo MariaDB
(`demo-db`, user and password `demo`) that serves as the app database and is the only allowed host.

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
