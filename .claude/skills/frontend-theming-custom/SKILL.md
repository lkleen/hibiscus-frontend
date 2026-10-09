---
name: frontend-theming-custom
description: Authoring a theme in the custom per-theme SCSS implementation — the five files to touch, required and optional custom properties in :root.theme-[name], dark-mode override blocks and the component override pattern. Use together with frontend-theming when creating or modifying a _theme-[name].scss file.
---

# Frontend — Theming (Custom CSS Implementation)

This skill documents the current implementation: per-theme SCSS files with CSS custom properties scoped to `:root.theme-[name]`. For the theming contract (token names, dark mode behavior, localStorage), see the `frontend-theming` skill.

## Theme Authoring

When creating a new theme, invoke the `frontend-design` skill first for the aesthetic design phase
(font pairing, color palette, atmosphere concept). Then implement using the reference below.
No need to read existing theme files — everything needed is documented here.

## Integration Checklist

Adding a new theme — touch these 5 files:

| File                                           | What to do                                            |
| ---------------------------------------------- | ----------------------------------------------------- |
| `apps/web/src/styles/_theme-[name].scss`       | Create token + override file                          |
| `apps/web/src/styles.scss`                     | Add `@use './styles/theme-[name]'`                    |
| `apps/web/src/app/core/models/theme.model.ts`  | Add to `ThemeName` union and `SUPPORTED_THEMES` array |
| `apps/web/src/assets/i18n/en.json` + `de.json` | Add `"theme.[name]": "Label"`                         |
| `apps/web/src/index.html`                      | Add Google Fonts `<link>` for any new font families   |

## Required CSS Properties

Required and optional CSS custom properties in `:root.theme-[name]`:

```scss
--font-sans: 'FontName', fallback;
--font-mono: 'JetBrains Mono', ui-monospace, monospace;
--font-display: 'FontName', fallback;
--color-accent: #hex;
--color-accent-hover: #hex;
--color-accent-subtle: #hex; // tinted bg for tags, inline code
// Surface overrides (optional — defaults from :root will apply if omitted)
--surface-ground: #hex;
--surface-card: #hex;
--surface-border: rgba(...);
--surface-hover: #hex;
--surface-subtle: #hex;
--surface-overlay: #hex;
--radius-base: 4px;

// Depth & motion (optional — defaults from :root will apply if omitted)
--shadow-card-hover: 0 8px 24px rgba(0, 0, 0, 0.1); // card hover shadow (none = flat, glow value = dramatic)
--shadow-overlay: 0 -4px 24px rgba(0, 0, 0, 0.12); // cookie banner / overlay lift shadow
--card-hover-lift: -2px; // translateY on card hover (0 = no lift, negative = rise)
--transition-duration: 0.15s; // base duration for all transitions (0.08s = snappy, 0.25s = fluid)

// Semantic (optional — defaults from :root will apply if omitted)
--text-on-accent: #ffffff; // text color on --color-accent backgrounds

// Typography personality (optional — defaults from :root will apply if omitted)
--heading-letter-spacing: var(--tracking-tight); // applied to h1–h4 globally
--heading-text-transform: none; // uppercase | none
--heading-weight: 700; // 400 | 600 | 700 (use 400 for monospace themes)

// Atmosphere (optional — transparent by default)
--surface-ambient: transparent; // fixed full-screen tint overlay; use for ambient color cast
```

## Dark Mode Overrides

Dark mode overrides go in `:root.theme-[name].dark-mode { ... }`

## Component Override Pattern

Theme-specific component overrides go in the per-theme SCSS file:

```scss
:root.theme-[name] .component-class {
  --component-name-token: value;
}
```

Component styles for `.btn`, `.toggle-group__item`, `.icon-btn` can be fully styled under
`:root.theme-[name] .btn { ... }` — each theme owns 100% of button appearance.
Themes override button appearance via `--btn-*` tokens:
`--btn-bg` · `--btn-color` · `--btn-radius` · `--btn-font-weight` · `--btn-letter-spacing` · `--btn-text-transform`
Use `:not(.btn--ghost):not(.btn--outline):not(.btn--icon)` when overriding primary buttons only, to avoid affecting modifier variants.
