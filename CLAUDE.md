# CLAUDE.md — hibiscus-frontend

Open-source web frontend for a [Hibiscus](https://www.willuhn.de/products/hibiscus/) home-banking
database (MariaDB-backed). See [docs/architecture.md](docs/architecture.md) for the data model and
package layout.

## Always loaded

@../claude-config/core.md
@../claude-config/checklist.md

## Context loading rules

Load context files on demand based on the task. All paths are relative to the project root.

| Task type                                              | Load                                                                                 |
|----------------------------------------------------------|---------------------------------------------------------------------------------------|
| Project structure, data model, package boundaries       | @docs/architecture.md                                                                 |
| Backend routes, repositories, the DB client              | @docs/architecture.md                                                                 |
| Forward-auth contract, `ALLOWED_USERS`, the demo compose | @docs/architecture.md#authentication                                                  |
| Build commands, local dev, environment setup             | @../claude-config/web-toolchain.md                                                    |
| Layout, flexbox, responsive design, CSS conventions       | @../claude-config/frontend.md                                                         |
| Component architecture, signals, DI, i18n                 | @../claude-config/frontend-angular.md                                                 |
| CDK overlays, a11y, virtual scroll, drag-drop              | @../claude-config/frontend-angular-cdk.md                                            |
| Tokens, theming, dark mode                                | @../claude-config/frontend-theming.md                                                 |
| Creating or modifying a theme file                        | @../claude-config/frontend-theming.md + @../claude-config/frontend-theming-custom.md  |
| Planning / plan mode (writing or updating a plan)          | @../claude-config/plan-mode.md                                                        |

**No Angular Material.** This project uses `@angular/cdk` primitives plus the custom token/component
system described in `frontend-theming.md`/`frontend-theming-custom.md` — do not add
`@angular/material` as a dependency.

## Project checklist

In addition to `@../claude-config/checklist.md`:

- **Never commit real banking data or credentials.** `*.sql`, `*.sql.gz`, and every `.env*`
  (except `.env.example`) are gitignored as a safety net — keep it that way.
- **Never weaken the auth contract.** The backend must refuse every request without both a valid
  identity header and a matching `INTERNAL_PROXY_SECRET`, unconditionally — no `APP_ENV` (or any
  other) flag may add a bypass. See `docs/architecture.md#authentication`.
- **Never publish the app's port in a Compose file.** Only a fronting proxy service may publish a
  port; the app itself stays on an internal Docker network in every shipped Compose file.
- Keep `docs/architecture.md` in sync when the data model, routes, or auth contract change.
- **Theming**: five named theme identities — `default`, `greenbar`, `vault`, `private`, `telex` —
  selected via a `theme-[name]` class on `<html>`, plus an independent light/dark axis via a
  `.dark-mode` class that coexists with the identity class. See `ThemeService`
  (`packages/frontend/src/app/core/services/theme.service.ts`): `setTheme(name)` changes identity,
  `setDarkMode(bool)` / `toggleDarkMode()` change the axis. `dark` is NOT a theme identity — every
  identity supports both light and dark; do not reintroduce a two-theme light/dark model. Each
  theme sets `color-scheme` directly (light in the base `:root.theme-[name]` block, dark in
  `:root.theme-[name].dark-mode`) for native form-control rendering. This matches the general
  contract in `../claude-config/frontend-theming.md` — see that file for the full token list before
  adding or modifying a theme.
