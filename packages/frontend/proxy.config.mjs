// Dev-only reverse proxy for `ng serve`.
//
// Forwards `/api` to the backend and injects the two headers the backend's forward-auth
// middleware requires on *every* request, unconditionally (see
// docs/architecture.md#authentication) — there is no dev-mode bypass in this app anywhere, by
// design. In production this app is only ever reached through an upstream proxy (Authentik,
// Keycloak + oauth2-proxy, Traefik forward-auth, ...) which authenticates the user and injects
// those same headers before the request reaches this app. `ng serve` has no such proxy in front
// of it locally, so this file stands in for one: a fixed dev identity header, plus the
// pre-shared secret that the root-level `scripts/start-local.sh` generates into a gitignored
// `.env.dev.local` on first run and exports as `INTERNAL_PROXY_SECRET` before launching
// `ng serve`. The backend cannot tell dev and production apart — same check, every time.
//
// This is a plain object (not JSON) because header injection needs the proxy's `configure` hook,
// which a declarative `proxy.config.json` cannot express.

const INTERNAL_PROXY_SECRET = process.env['INTERNAL_PROXY_SECRET'];

if (!INTERNAL_PROXY_SECRET) {
  throw new Error(
    'INTERNAL_PROXY_SECRET is not set. Run `pnpm start:local` from the repo root — ' +
      'scripts/start-local.sh generates it into .env.dev.local and exports it before starting ' +
      '`ng serve`. Running `ng serve` directly in this package skips that step.',
  );
}

export default {
  '/api': {
    target: 'http://localhost:3000',
    secure: false,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('X-Forwarded-User', 'local-dev@example.com');
        proxyReq.setHeader('X-Internal-Auth-Secret', INTERNAL_PROXY_SECRET);
      });
    },
  },
};
