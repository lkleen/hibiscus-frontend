# Light / Dark Theme System for hibiscus-frontend

## Context

`packages/frontend` shipped a single, fixed light palette — `tokens.scss` said so explicitly
("Single, fixed light theme for v1 — no theme switching, no dark mode, no persistence"). This
integrates the shared `claude-config` theming contract (`theme-[name]` class on `<html>`,
`localStorage`-persisted with a 1-hour TTL, OS-preference fallback) so the app offers a **light**
and a **dark** theme.

Two decisions were confirmed with the user up front:
1. **Scope** — this is the full named-theme contract (`ThemeName`/`SUPPORTED_THEMES`, per-theme
   SCSS files), not just a boolean dark-mode flag.
2. **Placement** — the toggle lives inside the existing `app-user-menu` dropdown (identity
   overlay, added in the same local work session), per `frontend.md`'s rule that preferences
   belong in a user menu, not primary navigation.

**Design decision made during planning:** the shared contract has two independent axes — a named
theme and a separate `.dark-mode` class that can combine with any theme. This app has no need for
that second axis: `dark` *is* this app's dark mode, and there's no third theme that would ever
need an independent dark variant. So this implements **only** `theme-light` / `theme-dark`
classes, with `color-scheme: light|dark` set per theme for native form-control rendering, and
explicitly does not add a separate `.dark-mode` class. This is documented in code and in
`packages/frontend/CLAUDE.md` so it reads as an intentional scoping choice, not a gap.

**Light vs. dark authorship:** the tokens already in `tokens.scss`'s `:root` were a coherent,
already-designed light palette — `light` simply names them (no new design pass needed). `dark` had
no existing palette anywhere in the repo, so its colors were designed via the `frontend-design`
skill (Phase 1) before any hex values were written.

## Phase 1 — Dark theme aesthetic design
- **Status:** done
- **Started:** 2026-09-24 09:15
- **Ended:** 2026-09-24 09:22

Invoked the `frontend-design` skill to design the `dark` theme: kept the existing font stacks
(color/atmosphere shift only), designed a dark surface hierarchy continuing the light theme's
muted forest-green accent identity (brightened to `#5fb98c` for legibility on dark surfaces, with
dark-on-accent button text rather than white-on-accent), and verified WCAG 2.1 AA contrast
(≥4.5:1 body text, ≥3:1 large text/UI boundaries) for every text/surface pairing. Output token
table transcribed directly into Phase 2's `_theme-dark.scss`.

## Phase 2 — Core theming infrastructure
- **Status:** done
- **Started:** 2026-09-24 09:22
- **Ended:** 2026-09-24 09:35

New: `app/core/models/theme.model.ts` (`ThemeName`, `SUPPORTED_THEMES`, `THEME_LABELS`),
`app/core/utils/theme-resolution.ts` (localStorage + 1h TTL + OS-preference resolution,
`persistTheme`), `app/core/services/theme.service.ts` (`currentTheme` signal, `setTheme`,
`toggleTheme`), `styles/_theme-light.scss`, `styles/_theme-dark.scss`.

Edited: `styles/tokens.scss` (replaced stale single-theme comment), `styles.scss` (`@use` both
theme files), `index.html` (inline FOUC-prevention script, hand-ported copy of
`resolveInitialTheme`'s algorithm, documented as needing to stay in sync), `CLAUDE.md` (documented
the no-separate-`.dark-mode` scoping decision).

## Phase 3 — Theme toggle in the user menu
- **Status:** done
- **Started:** 2026-09-24 09:35
- **Ended:** 2026-09-24 09:40

Added a labeled `role="group"` row of Light/Dark buttons to `app-user-menu`'s dropdown panel,
below the existing identity block. `ThemeService` injected; `[attr.aria-pressed]` reflects the
active theme; `:focus-visible`-only outline; `pointer: coarse` padding for the 44×44 touch target;
hover/active transition gated behind `prefers-reduced-motion: no-preference`.

## Phase 4 — Tests
- **Status:** done
- **Started:** 2026-09-24 09:40
- **Ended:** 2026-09-24 09:56

Added `theme-resolution.spec.ts`, `theme.service.spec.ts`, `user-menu.component.spec.ts`
(Vitest, co-located `*.spec.ts`). Discovered this repo's test environment aliases `window` to
Node's global scope, whose own experimental `localStorage` is disabled without a CLI flag —
neither bare `localStorage` nor `window.localStorage` works out of the box in tests. Added a
shared in-memory mock, `app/core/utils/testing/local-storage-mock.ts` (used by all three new spec
files — the third repetition that crossed this project's DRY threshold), rather than duplicating
the stub three times or leaving tests flaky.

All 25 frontend tests pass (`pnpm test`).

## Phase 5 — Verification
- **Status:** in progress
- **Started:** 2026-09-24 09:56
- **Ended:**

Automated, from repo root — all pass with zero warnings:
```bash
pnpm format:fix
pnpm format:check
pnpm lint
pnpm test
pnpm build
```

Also verified via the running dev stack (`pnpm start:local`, Docker DB + backend + `ng serve`):
- Served `index.html` contains the FOUC-prevention script (`bm-theme`, `theme-light`,
  `theme-dark` all present).
- Compiled `styles.css` contains `.theme-light`/`.theme-dark` selectors and the designed dark
  palette values (`color-scheme: dark`/`light`, `#5fb98c`, `#14181a`, `#63727b`).
- Backend/frontend both started with no errors; `/api/me` responds correctly through the dev
  proxy.

**Not yet done:** interactive manual QA in an actual browser (opening the user menu, clicking
Light/Dark, checking `localStorage['bm-theme']`, reload persistence/no-flash, OS-preference
emulation, reduced-motion, keyboard navigation) — the Chrome browser automation extension was not
connected in this session. The dev stack was left running at http://localhost:4200 for the user
to do this pass themselves; see the manual QA checklist in the original plan for the exact steps.
