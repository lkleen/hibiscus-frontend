---
name: frontend-angular-cdk
description: Angular CDK rules — Material → CDK → custom selection hierarchy, a use-case-to-API reference (a11y, overlays, portals, scrolling, drag-drop, layout, menus, text fields, clipboard), focus traps, LiveAnnouncer, key managers, virtual scroll for lists over ~50 items, DestroyRef cleanup and CDK testing. Use for overlays, popovers, focus management, keyboard navigation, virtual scroll, drag-drop or any CDK primitive in an Angular project.
---

# Frontend — Angular CDK

**Component selection hierarchy: Angular Material → Angular CDK → custom.**
If Angular Material provides a component for the use case, use it — do not reach for raw CDK primitives when a Material equivalent exists. Use CDK primitives only when Material has no component for the pattern. Build a fully custom component only when neither Material nor CDK covers it. Raw DOM APIs are a last resort for cases CDK has no primitive for (e.g. `ResizeObserver` for the Compact-Signal pattern).

## CDK use-case reference

**Accessibility (`@angular/cdk/a11y`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Confine focus inside modal / panel         | `FocusTrap` / `FocusTrapFactory`             |
| Detect focus origin (keyboard vs mouse)    | `FocusMonitor`                               |
| Screen reader announcements                | `LiveAnnouncer`                              |
| Keyboard navigation in lists               | `ListKeyManager` / `ActiveDescendantKeyManager` |
| Select-like component (no Material)        | `CdkListbox` + `CdkOption`                   |
| Combobox / autocomplete (no Material)      | `CdkCombobox`                                |
| Check element interactivity                | `InteractivityChecker`                       |
| High contrast mode detection               | `HighContrastModeDetector`                   |

**Overlays (`@angular/cdk/overlay`)** — only when Material overlay components don't cover the use case
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Anchored dropdown / popover (custom)       | `Overlay` + `FlexibleConnectedPositionStrategy` |
| Centered / full-screen overlay (custom)    | `Overlay` + `GlobalPositionStrategy`         |
| Project template into overlay              | `TemplatePortal`                             |
| Project component into overlay             | `ComponentPortal`                            |
| Unstyled dialog primitive                  | `CdkDialog`                                  |

**Scrolling (`@angular/cdk/scrolling`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Virtualised list (>50 items)               | `CdkVirtualScrollViewport` + `*cdkVirtualFor`|
| Listen to scroll across containers         | `ScrollDispatcher`                           |
| Read viewport dimensions                   | `ViewportRuler`                              |

**Drag and drop (`@angular/cdk/drag-drop`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Draggable item                             | `cdkDrag`                                    |
| Drop zone                                  | `cdkDropList`                                |
| Reorder within list                        | `moveItemInArray`                            |
| Move between lists                         | `transferArrayItem`                          |
| Restrict drag to handle                    | `cdkDragHandle`                              |

**Layout (`@angular/cdk/layout`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Viewport breakpoint observation            | `BreakpointObserver`                         |
| Raw media query matching                   | `MediaMatcher`                               |

**Menus (`@angular/cdk/menu`)** — only when Material menu doesn't fit
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Custom unstyled menu                       | `CdkMenu` + `CdkMenuItem` + `CdkMenuTrigger`|
| Menu bar                                   | `CdkMenuBar`                                 |

**Text fields (`@angular/cdk/text-field`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Auto-growing textarea                      | `cdkTextareaAutosize`                        |
| Detect browser autofill                    | `AutofillMonitor`                            |

**Portals (`@angular/cdk/portal`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Render content at arbitrary DOM location   | `Portal` + `CdkPortalOutlet`                 |

**Collections (`@angular/cdk/collections`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Track selected items                       | `SelectionModel`                             |
| Custom data source for tables / lists      | `DataSource`                                 |

**Clipboard (`@angular/cdk/clipboard`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Copy text to clipboard                     | `Clipboard.copy()`                           |

**Bidirectionality (`@angular/cdk/bidi`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Detect / react to RTL layout               | `Directionality`                             |

**Observers (`@angular/cdk/observers`)**
| Use case                                   | API                                          |
| ------------------------------------------ | -------------------------------------------- |
| Watch DOM content changes                  | `ContentObserver`                            |

## General Principles

- Keep CDK logic in the component class. Templates only reference CDK directives — never call CDK services directly from template expressions.
- Wrap CDK primitives in your own services or base classes so components depend on your abstraction, not CDK directly.
- Use `inject()` for CDK services — never constructor injection.

```typescript
// preferred
private overlay = inject(Overlay);
private focusTrap = inject(FocusTrapFactory);
```

- Clean up CDK resources using `inject(DestroyRef).onDestroy()` — not `ngOnDestroy`.

```typescript
private destroyRef = inject(DestroyRef);

// in setup:
this.destroyRef.onDestroy(() => this.overlayRef?.dispose());
```

---

## Accessibility (`@angular/cdk/a11y`)

- Use CDK `a11y` primitives instead of manually managing ARIA attributes or focus.
- Use `FocusTrap` to confine focus inside modals and dialogs — never manage this manually with tabindex overrides.
- Use `FocusMonitor` to detect how focus arrived (keyboard vs mouse) and style accordingly. Never suppress focus outlines without a visible alternative tracked via `FocusMonitor`.
- Use `LiveAnnouncer` for dynamic content changes that screen readers must announce (loading states, error messages, count changes).
- Use `ActiveDescendantKeyManager` or `ListKeyManager` for any component with keyboard-navigable lists (menus, autocomplete, comboboxes).
- Use `CdkListbox` / `CdkCombobox` for select-like components — never build keyboard navigation or ARIA roles for these from scratch.

```typescript
private liveAnnouncer = inject(LiveAnnouncer);

onItemsLoaded(count: number) {
  this.liveAnnouncer.announce(`${count} results loaded`);
}
```

---

## Overlays and Portals (`@angular/cdk/overlay`)

- Use `Overlay` for dropdowns, tooltips, popovers, and context menus. Never position these with `position: fixed` or `position: absolute` manually.
- Use `FlexibleConnectedPositionStrategy` for overlays anchored to a trigger element — it repositions automatically near viewport edges.
- Use `TemplatePortal` or `ComponentPortal` to project content into overlays — never manipulate the DOM directly.
- Close overlays on backdrop click and Escape key — use `overlayRef.backdropClick()` and `overlayRef.keydownEvents()` observables.
- Always dispose the `OverlayRef` via `inject(DestroyRef).onDestroy()`.

---

## Scrolling (`@angular/cdk/scrolling`)

- Use `CdkVirtualScrollViewport` for any list that could exceed ~50 items. Never render unbounded lists.
- Use `ScrollDispatcher` to listen to scroll events across nested scrollable containers — never attach raw `scroll` listeners to elements directly.
- Use `ViewportRuler` instead of reading `window.innerWidth` / `window.innerHeight` directly.

```html
<cdk-virtual-scroll-viewport itemSize="48" style="height: 400px;">
  <!-- *cdkVirtualFor is CDK's own directive — do NOT replace it with @for -->
  <div *cdkVirtualFor="let item of items">{{ item.name }}</div>
</cdk-virtual-scroll-viewport>
```

---

## Drag and Drop (`@angular/cdk/drag-drop`)

- Always use `@angular/cdk/drag-drop` for draggable UI — never implement drag behavior with raw `mousedown` / `touchstart` events.
- Always handle `cdkDropListDropped` by updating the data model using `moveItemInArray` or `transferArrayItem` — never mutate the DOM directly.
- Use `cdkDragHandle` to restrict drag initiation to a specific handle element.

```typescript
import { moveItemInArray } from '@angular/cdk/drag-drop';

onDrop(event: CdkDragDrop<Item[]>) {
  moveItemInArray(this.items, event.previousIndex, event.currentIndex);
}
```

---

## Layout and Responsiveness (`@angular/cdk/layout`)

- Use `BreakpointObserver` only for **viewport-level** layout decisions (page layout, navigation patterns). Never use it as a proxy for "does my content fit?" — see the Compact-Signal pattern in the `frontend` skill.
- For component-level responsiveness, use CSS container queries for style changes and `ResizeObserver` on `:host` for template switching (see Compact-Signal pattern).
- Any component that uses `ResizeObserver` on its own host must have `display: block` (or `display: flex`) on `:host` — inline elements and `display: contents` have no measurable box. This overrides the `display: contents` rule from the `frontend` skill only for self-observing components.
- Derive breakpoints from measured DOM dimensions. Never hardcode pixel values as fixed thresholds.
- Always disconnect `ResizeObserver` via `inject(DestroyRef).onDestroy()`.

---

## Testing

- Test behavior, not implementation details. Test that focus moves correctly and keyboard navigation works — not that a specific CDK method was called.
- Use `FocusMonitor` test helpers from `@angular/cdk/testing` for focus-related assertions.
- Use `ComponentHarness` from `@angular/cdk/testing` for component interaction in tests.

---

## What CDK Does Not Replace

| Concern                   | Use instead                  |
| ------------------------- | ---------------------------- |
| Form state and validation | `@angular/forms`             |
| HTTP and data fetching    | `@angular/common/http`       |
| Routing                   | `@angular/router`            |
| State management          | NgRx, signals, or services   |
| Animation                 | `@angular/animations` or CSS |
| Page-level SEO / SSR      | `@angular/ssr`               |
