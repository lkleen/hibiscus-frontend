---
name: frontend
description: Framework-agnostic frontend rules — navigation vs. user preferences, BEM and structural-only component SCSS with --component-* tokens (no hardcoded visual values), flexbox rules (gap, flex: 1, min-width: 0, display: contents), mobile-first breakpoints, the container-driven compact-signal ResizeObserver pattern, touch targets and accessibility (focus-visible, ARIA labelling, reduced motion, contrast). Use for any layout, CSS/SCSS, responsive design or component styling work.
---

# Frontend

## Navigation vs. User Preferences

**Side navigation is for moving between views** — its items change what the user sees right now.
**User preferences (dark mode, language, theme) belong in a user menu or settings panel**, not in the nav.

The distinction: navigation items are _primary actions_ executed frequently by all users. Preferences are _rarely changed settings_ that are personal and persistent. Mixing them in the same surface (e.g., adding a dark mode toggle to the side nav) dilutes the nav's purpose and creates discoverability problems — icon-only preference toggles require tooltips to understand, while nav links are self-evident from context.

Rule of thumb: if changing the item does not navigate the user to a different view, it belongs in the user menu, not the navigation.

## Code Conventions

- CSS naming: BEM for component classes, custom `--surface-*` / `--text-*` / `--color-accent` tokens for colors/surfaces

## Component Authoring Rules

When introducing a new component, follow the frontend design system architecture strictly:

**Component SCSS is structural-only.**
Component `.scss` files contain only layout, spacing, and structural rules (flexbox, grid, padding, margin, position). No colors, backgrounds, shadows, borders, or typography details — those are set exclusively in theme files via `:root.theme-[name] .component-class { }`.

**Use component-scoped CSS custom properties.**
All visual properties must be expressed via `--component-name-*` tokens defined inside the component's own CSS class. These tokens reference global design tokens as defaults and are overridable by themes:

```scss
.my-component {
  --my-component-bg: transparent;
  --my-component-color: var(--text-muted);
  --my-component-border-color: var(--surface-border);
  --my-component-radius: var(--radius-base);

  background: var(--my-component-bg);
  color: var(--my-component-color);
  border: 1px solid var(--my-component-border-color);
  border-radius: var(--my-component-radius);
}
```

Theme files then override only the component tokens they need:

```scss
:root.theme-foo .my-component {
  --my-component-bg: var(--color-accent-subtle);
  --my-component-radius: 999px;
}
```

**No hardcoded visual values in component SCSS.** All property values reference tokens — either global (`--surface-*`, `--text-*`, `--radius-base`, `--transition-duration`) or the component's own `--component-*` tokens.

**Token default values must also reference global tokens.** The right side of a component-scoped token declaration must be `var(--global-token)`, never a raw CSS value. `--overlay-backdrop-bg: var(--color-scrim)` ✓ — `--overlay-backdrop-bg: rgba(0,0,0,0.45)` ✗. Concrete values belong only in `:root` and `:root.theme-[name]` blocks.

**The `--ds-*` namespace is separate.** The design token system uses the `--ds-*` prefix. Never reference `--ds-*` tokens from component SCSS or theme files — they are a design specification layer only.

## Flexbox Layout Rules

**Use `gap` for all intra-container spacing.** Never use `margin` between flex siblings. Spacing always lives on the parent container, not on individual items.

**Always write `flex: 1`, never `flex-grow: 1` alone.** `flex: 1` = `flex: 1 1 0%` — it correctly sets shrink and basis. `flex-grow: 1` alone leaves `flex-basis: auto`, causing inconsistent sizing.

**Always add `min-width: 0` to any element that is both a flex item and a flex container.** Flex items default to `min-width: auto`, preventing shrinking below content size. Any nested layout container inside a flex row needs this.

**Never write `flex-direction: row`.** It is the default — omit it. Only write `flex-direction` to override to `column`, `row-reverse`, or `column-reverse`.

**Use `display: contents` on `:host` for wrapper-less components.** When a component exists only to project a root element into a parent flex/grid container, set `:host { display: contents }`. Use `display: block` or `display: flex` on `:host` only when the host itself participates in layout.

**Use `display: inline-flex` for inline UI controls.** Buttons, icon buttons, and chips are inline-level — use `inline-flex` so they participate in text/inline flow.

**Use `margin-inline-start: auto` to push items to the trailing edge.** Do not use `justify-content: space-between` to separate a leading group from a trailing group. Auto-margin composes correctly when items are extracted into sub-components.

**Use `flex-wrap: wrap` only for content that must reflow** (tag/chip lists, nav links). Do not apply it speculatively — most rows should clip or scroll at narrow sizes, not reflow.

**Gap size conventions:**

| Size            | Context                                       |
| --------------- | --------------------------------------------- |
| `0.25rem`       | Dense button/icon groups                      |
| `0.4rem–0.5rem` | Chip/tag lists, inline meta groups            |
| `0.75rem–1rem`  | Component inner layout, section rows          |
| `1.5rem–2rem`   | Section-level layout, card stacks             |

**Canonical flex container pattern:**

```scss
.my-component__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0; // required when nested inside another flex/grid container
}

// Trailing group pushed to the end:
.my-component__actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-inline-start: auto;
}
```

## Responsive Design

- Mobile-first: write default styles for mobile, enhance with `@media (min-width: ...)` — never `max-width`
- Use only the defined breakpoints: `640px` (sm), `768px` (md), `1024px` (lg), `1280px` (xl), `1536px` (2xl)
- Add a comment referencing the token name: `@media (min-width: 768px) { // --ds-breakpoint-md`
- Use `pointer: coarse` / `pointer: fine` for touch vs. mouse — never use breakpoints as a proxy for input type
- **No JS-driven layout decisions based on viewport or element size.** Use CSS media queries or container queries for responsive show/hide. One JS exception is permitted:
  - **Intrinsic overflow detection** via `ResizeObserver` — comparing an element's content width (`scrollWidth`) against its allocated width (`clientWidth`) to determine whether content fits. Never compare against viewport width, `getBoundingClientRect` positions, or hardcoded pixel thresholds. Never use `BreakpointObserver` or viewport media queries as a proxy for "does my content fit?" — viewport width does not account for sibling layout pressure.

### Compact-Signal Pattern (Container-Driven Compaction)

When a flex container has children that must switch to a compact representation when space is tight, the **container** owns the `ResizeObserver` — not the children. This ensures all compactable children respond in lockstep from a single authoritative measurement.

**Rules:**

1. **The container observes its own flex element.** Attach `ResizeObserver` to the container's real DOM element (not a `:host` with `display: contents` — that has no layout box). Compare `scrollWidth > clientWidth` to detect overflow.
2. **The container computes a `compact` signal** and passes `[compact]="compact()"` to each compactable child.
3. **Compactable children declare `readonly compact = input<boolean>(false)`** directly on the component class.
4. **Children keep measurement-element internals.** The expanded view stays in the DOM with `inert` + `visibility: hidden; height: 0` when compact, so the container's `scrollWidth` still reflects full expanded width — no oscillation when compacted.
5. **The compact fallback is positioned absolutely** inside the child's `:host` (`position: relative`), on top of the invisible expanded element.
6. **Use `inert` + `aria-hidden` on the hidden view** to remove it from focus order and AT.

```scss
// Child's expanded view — always in DOM, hidden when compact:
.toggle-clip {
  display: flex;
  min-width: 0;
  overflow: hidden;

  &[inert] {
    visibility: hidden;
    height: 0;
    pointer-events: none;
  }
}

// Child's compact fallback — absolutely positioned over the hidden expanded view:
.toggle-compact {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-end: 0;
  transform: translateY(-50%);
}
```

**Why not `BreakpointObserver` / viewport media queries?** Viewport width is a poor proxy for whether content fits. The available space depends on sibling elements in the flex chain, which vary by theme, locale, and font. Intrinsic overflow detection responds to actual allocated space regardless of device or nesting depth.

## Touch Targets

All interactive elements (buttons, inputs, table row actions) must have a minimum hit area of 44×44px when `pointer: coarse` is detected. Use padding, not height, to achieve this so the visual size can differ from the hit area.

## Accessibility

**Use semantic HTML — ARIA is a last resort.** Prefer native elements (`<button>`, `<a>`, `<label>`, `<nav>`, `<main>`) over `role=` on divs or spans. Native elements carry keyboard behaviour, implicit roles, and AT mapping for free. Only reach for ARIA when no native element fits the pattern.

**Never remove focus indicators without a replacement.** Do not write `outline: none` or `outline: 0` unless a custom `:focus-visible` style is present in the same rule block. Focus styles must be visible against both light and dark themes — use token-based colors:

```scss
.my-component__trigger {
  outline: none;

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
}
```

Target `:focus-visible`, not `:focus` — `:focus` fires on mouse click and creates visual noise for pointer users.

**ARIA labelling rules:**
- Icon-only buttons must have `aria-label` describing the action (e.g. `aria-label="Close"`).
- Never duplicate visible text in `aria-label` — if the label is already in the DOM, use `aria-labelledby` pointing to it.
- Decorative icons and SVGs that convey no meaning must have `aria-hidden="true"` and no focusable children.
- Do not use `aria-label` and visible text together on the same element unless the visible text is insufficient (e.g. an icon button where the label clarifies the target).

**Wrap all transitions and animations in `prefers-reduced-motion`.** The default (no media query) must have zero or near-zero duration. Apply motion only when the user has not opted out:

```scss
.my-component {
  // No transition at baseline — respects reduced-motion by default
}

@media (prefers-reduced-motion: no-preference) {
  .my-component {
    transition: opacity var(--transition-duration) ease;
  }
}
```

Do not invert this — never wrap `transition: none` in `prefers-reduced-motion: reduce`. The motion-free state is the baseline.

**Use a `.visually-hidden` utility for screen-reader-only content.** Never use `display: none` or `visibility: hidden` for text that must be available to assistive technology — those remove the element from the AT tree entirely:

```scss
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Use `inert` + `aria-hidden` (not `visually-hidden`) when hiding the element from both sighted users and AT — see the Compact-Signal pattern.

**Color contrast must meet WCAG 2.1 AA.** Body text against its background: ≥ 4.5:1. Large text (≥ 18px regular or ≥ 14px bold) and UI component boundaries: ≥ 3:1. Because all colors are expressed through `--text-*` and `--surface-*` tokens (see Component Authoring Rules), contrast must be validated at the token level — hardcoding colors in component SCSS also bypasses this guarantee and is prohibited for this reason too.
