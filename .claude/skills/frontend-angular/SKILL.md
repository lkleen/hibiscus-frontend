---
name: frontend-angular
description: Angular 21 code conventions — OnPush, signals, inject(), input()/output()/model(), signal queries, host metadata, @if/@for/@switch control flow, no ngClass/ngStyle, NgOptimizedImage, i18n keys in both en.json and de.json, locale-prefixed routing, the Angular implementation of the compact-signal pattern and Angular CLI commands. Use for any Angular component, directive, service, routing or i18n work.
---

# Frontend — Angular

For CDK-specific rules (overlays, a11y, virtual scroll, drag-drop, layout), see the `frontend-angular-cdk` skill.

## Version

use Angular 21

## MCP

Check if the mcp server is installed if not do it our guide the user to install it with.
Note that the according node modules package must be installed if not present.

````
claude mcp add angular-cli -- npx -y @angular/cli mcp
````

## Code Conventions

- All components: `ChangeDetectionStrategy.OnPush`, signals for state, `inject()` for DI. Do **not** set `standalone: true` — it is the default in Angular v20+.
- **Use the most modern stable Angular APIs.** When creating or modifying components, always prefer the current idiomatic approach over legacy alternatives. This applies broadly — `input()`/`output()`/`model()` over `@Input`/`@Output`, `host` metadata over `@HostBinding`/`@HostListener`, signal queries (`viewChild()`, `contentChild()`, `viewChildren()`, `contentChildren()`) over `@ViewChild`/`@ContentChild`, `inject()` over constructor injection, control flow (`@if`/`@for`/`@switch`) over `*ngIf`/`*ngFor`/`[ngSwitch]`, etc. Before generating code, verify the chosen API is **stable** (not developer preview or experimental) in Angular 21. Never use APIs marked `@developerPreview` or `@experimental`.
- Do not use `ngClass` — use `class` bindings instead. Do not use `ngStyle` — use `style` bindings instead.
- Images: use `NgOptimizedImage` for all static images (does not apply to inline base64).
- Styles: component-level SCSS via `styleUrl`, global design tokens in `apps/web/src/styles.scss`
- i18n: all user-visible strings via `TranslationService.t('key')` — always add keys to **both** `en.json` and `de.json`

## Routing

- All routes are locale-prefixed: `/:locale/...` (supported: `en`, `de`)
- Locale is read from the URL via `LocaleService.currentLocaleFromUrl()`
- Navigation links must include the current locale segment

## Compact-Signal Pattern — Angular Implementation

The container uses `afterNextRender()` to attach the `ResizeObserver`. Signal writes (`.set()`) are zone-agnostic and trigger change detection automatically — no `NgZone.run()` needed. Compactible children extend the `Compactible` base class from `apps/web/src/app/shared/components/compactible.ts`.

```typescript
// Container (e.g. ActionsComponent) — inside afterNextRender():
readonly compact = signal(false);

// ...
const containerEl = this.el.nativeElement.querySelector('.my-container');
if (containerEl) {
  const observer = new ResizeObserver(() => {
    const overflows = containerEl.scrollWidth > containerEl.clientWidth;
    this.compact.set(overflows);
  });
  observer.observe(containerEl);
  this.destroyRef.onDestroy(() => observer.disconnect());
}
```

```typescript
// Compactible child (e.g. LocaleSwitcherComponent):
export class LocaleSwitcherComponent {
  readonly compact = input<boolean>(false);
  // ...
}
```


## Angular CLI — Common Commands

Run from the app directory (e.g. `apps/web/`):

```bash
ng serve           # dev server (without starting any backend services)
ng build           # production build
ng test            # run unit tests once (no watch)
ng generate component path/to/name
ng generate service path/to/name
```

In a Turborepo monorepo, prefer `pnpm build` / `pnpm test` / `pnpm lint` from the repo root so
Turborepo can cache and parallelise across packages. Use `ng` directly only when you need to target
a single app without running the full pipeline.
