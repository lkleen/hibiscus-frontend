---
name: frontend-theming
description: Theming contract — theme-[name] and .dark-mode classes on <html> set by ThemeService, the bm-theme localStorage key with a 1-hour TTL, the full global token list (--surface-*, --text-*, --color-accent*, scrim, depth, motion, typography, type scale), overridable component classes and --btn-* tokens, and what an alternative implementation must honour. Use for design tokens, theming or dark mode, and before adding or changing a theme.
---

# Frontend — Theming

## Theming Contract

The current implementation uses a custom CSS token system — see the `frontend-theming-custom` skill for authoring details.

- Active theme: `theme-[name]` class on `<html>` set by `ThemeService.setTheme(name)` (e.g. `theme-copper`)
- Dark mode: `.dark-mode` class on `<html>` toggled by `ThemeService.toggleTheme()` — coexists with the theme class
- Both theme name and dark mode are persisted to `localStorage` under key `bm-theme`, with a `savedAt` timestamp
- Stored preferences expire after **1 hour** (`savedAt` TTL) — returning visitors after that get the OS preference again
- First-time visitors (no `bm-theme` in localStorage) default to OS preference via `prefers-color-scheme: dark`
- Theming is pure CSS — no JS preset system. Theme switching manipulates classList only.

## Token System

Components reference these CSS custom properties exclusively — never hardcoded values.

Surface tokens (overridable per theme):

- `--surface-ground` — page background
- `--surface-section` — section/panel background
- `--surface-card` — card background
- `--surface-overlay` — cookie banner, modal background
- `--surface-border` — borders
- `--surface-hover` — hover state backgrounds
- `--surface-subtle` — subtle separator backgrounds
- `--radius-base` — default border radius

Text tokens (overridable per theme):

- `--text-color` — primary text
- `--text-muted` — secondary/muted text
- `--text-on-accent` — text color on `--color-accent` backgrounds (default `#ffffff`)

Accent tokens (overridable per theme):

- `--color-accent` — primary accent color
- `--color-accent-hover` — accent hover state
- `--color-accent-subtle` — tinted background for tags, inline code

Scrim & backdrop tokens (overridable per theme):

- `--color-scrim` — semi-transparent backdrop color for modals/overlays (default `rgba(0,0,0,0.45)`)
- `--blur-overlay` — backdrop-filter blur intensity for overlay backdrops (default `blur(4px)`)

Depth & motion tokens (overridable per theme):

- `--shadow-card-hover` — card hover shadow (`none` = flat, glow value = dramatic)
- `--shadow-overlay` — overlay/modal panel shadow (downward, e.g. `0 8px 32px rgba(0,0,0,0.16)`)
- `--card-hover-lift` — `translateY` on card hover (`0` = no lift, negative = rise)
- `--transition-duration` — base duration for all transitions (`0.08s` = snappy, `0.25s` = fluid)

Typography tokens (overridable per theme):

- `--font-sans` — body font stack
- `--font-mono` — monospace font stack
- `--font-display` — display/heading font stack
- `--heading-letter-spacing` — applied to all h1–h4 globally (default `var(--tracking-tight)`)
- `--heading-text-transform` — `uppercase | none` (default `none`)
- `--heading-weight` — `400 | 600 | 700` (default `700`; use `400` for monospace themes)

Atmosphere token (overridable per theme):

- `--surface-ambient` — fixed full-screen tint overlay (default `transparent`; use for ambient color cast like the terminal phosphor tint or bathyal bioluminescent glow)

Type scale tokens (read-only, shared):

- `--text-xs` `--text-sm` `--text-base` `--text-md` `--text-lg` `--text-xl` `--text-2xl` `--text-3xl` `--text-4xl` `--text-5xl`
- `--leading-tight` `--leading-snug` `--leading-normal` `--leading-relaxed`
- `--tracking-tight` `--tracking-normal` `--tracking-wide` `--tracking-wider`
- `--layout-max-width` `--layout-prose-width` `--layout-padding-x`

## CSS Class Reference

All overridable classes by component — theme implementations target these:

**Header** — `.header` (tokens: `--header-bg` · `--header-border-color` · `--header-blur`) · `.header__brand` · `.header__brand-name` · `.header__brand-role` · `.header__nav-link` · `.header__nav-link--active` · `.header__actions`

**Footer** — `.footer` (tokens: `--footer-bg` · `--footer-border-color`)

**Overlay** — `.overlay__backdrop` (tokens: `--overlay-backdrop-bg` · `--overlay-backdrop-blur`) · `.overlay__panel` (tokens: `--overlay-panel-bg` · `--overlay-panel-shadow` · `--overlay-panel-radius`)

**Chip** — `.chip` (rendered by `<app-chip>` — override via `--chip-*` tokens)

## Button Tokens

Themes override button appearance via `--btn-*` tokens:
`--btn-bg` · `--btn-color` · `--btn-radius` · `--btn-font-weight` · `--btn-letter-spacing` · `--btn-text-transform`

## Alternative Implementations

The current implementation uses custom per-theme SCSS files (see the `frontend-theming-custom` skill). Any replacement — such as Angular Material or another design system — must honour this contract:

1. **Theme selector**: Set `theme-[name]` class on `<html>`, or map the implementation's own mechanism to produce the same CSS custom properties listed in the Token System section above.
2. **Dark mode**: Respect `.dark-mode` on `<html>` as the authoritative dark-mode selector. Other mechanisms may coexist, but `.dark-mode` is what the CSS responds to.
3. **Token coverage**: All tokens listed in the Token System must be provided; omitted tokens fall back to `:root` defaults in `src/styles.scss`.
4. **Persistence**: Preserve the `bm-theme` localStorage key and 1-hour TTL, or update `checklist.md` (claude-config root) with the new key if changed.

**When using Angular Material:** Material's `--mat-*` tokens can be mapped to `--surface-*` and `--color-accent-*` in a per-theme `:root.theme-[name]` override block. The `ThemeService` classList logic (`theme-[name]` and `.dark-mode` on `<html>`) remains identical — only the CSS implementation behind the tokens changes.
