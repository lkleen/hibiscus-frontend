# CLAUDE.md — hibiscus-frontend

Open-source web frontend for a [Hibiscus](https://www.willuhn.de/products/hibiscus/) home-banking
database (MariaDB-backed). See [docs/architecture.md](docs/architecture.md) for the data model and
package layout.

## Always loaded

@../claude-config/core.md
@../claude-config/checklist.md

## Context loading rules

Load context files on demand based on the task. All paths are relative to the project root and are
deliberately **not** `@` imports — an `@` import is expanded into every session.

Skills containing a `.copied-from-claude-config` file are copies from `../claude-config/skills/`. Never
edit them here — edit the skill in `claude-config` and re-run `pnpm run copy-skills` there.

| Task type                                              | Load                                                                                 |
|----------------------------------------------------------|---------------------------------------------------------------------------------------|
| Project structure, data model, package boundaries       | `docs/architecture.md`                                                                 |
| Backend routes, repositories, the DB client              | `docs/architecture.md`                                                                 |
| Forward-auth contract, `ALLOWED_USERS`, the demo compose | `docs/architecture.md#authentication`                                                  |
| Build commands, local dev, environment setup             | `web-toolchain` skill                                                    |
| Layout, flexbox, responsive design, CSS conventions       | `frontend` skill                                                         |
| Component architecture, signals, DI, i18n                 | `frontend-angular` skill                                                 |
| CDK overlays, a11y, virtual scroll, drag-drop              | `frontend-angular-cdk` skill                                            |
| Tokens, theming, dark mode                                | `frontend-theming` skill                                                 |
| Creating or modifying a theme file                        | `frontend-theming` skill + `frontend-theming-custom` skill  |
| Transactions table — columns, `/api/transactions`, grid sort/filter/group | `transactions-table` skill (`.claude/skills/transactions-table`)                        |
| Any table or grid work (`p-table`, `p-treetable`)         | `angular-primeng-table` skill (`.claude/skills/angular-primeng-table`)                 |
| Planning / plan mode (writing or updating a plan)          | `plan-mode` skill                                                        |
| Executing an approved plan                                 | `plan-execution` skill (`.claude/skills/plan-execution`)                              |

**No Angular Material.** This project uses `@angular/cdk` primitives plus the custom token/component
system described in the `frontend-theming`/`frontend-theming-custom` skills — do not add
`@angular/material` as a dependency.

**Tables are PrimeNG.** This project's table library is PrimeNG (`p-table`, `p-treetable`) — see the
`angular-primeng-table` skill. There is **no ag-Grid Enterprise licence** for this project, and
ag-Grid Community cannot do tree data, so ag-Grid was removed rather than kept as a second option:
do not reintroduce `ag-grid-angular`/`ag-grid-community`. Every table uses `<app-data-table>`
(`packages/frontend/src/app/shared/components/data-table/`); new table features go into that
component (switchable, with replaceable default lambdas), never into a feature. Never put `<p-table>`
in a feature template. The table still follows the active theme through the CSS bridge in
`src/styles/_primeng-table.scss`.

**Stay on PrimeNG 21.** It pairs with Angular 21 (`primeng@22` peers Angular 22) and, unlike 22, is
MIT-licensed. PrimeNG 22 moved to the commercial PrimeUI model, whose free Community tier requires a
small-company profile this project cannot assume — so a 21 → 22 bump is a licensing decision, not a
version bump. Raise it, never do it silently.

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
  contract in the `frontend-theming` skill — see that skill for the full token list before
  adding or modifying a theme.
