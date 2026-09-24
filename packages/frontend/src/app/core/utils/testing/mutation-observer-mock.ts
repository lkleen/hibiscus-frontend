/**
 * Under zone.js + happy-dom, `globalThis.MutationObserver` is a bare zone wrapper with no
 * `observe`/`disconnect`, which CDK overlays call when attaching and disposing a pane (the pane
 * cleanup that runs on component destroy throws otherwise). Real browsers are unaffected.
 * Stubs a no-op observer for a single test; pair with `vi.unstubAllGlobals()` in `afterEach`.
 */
export function installMutationObserverMock(): void {
  class NoopMutationObserver implements MutationObserver {
    observe(): void {
      // No DOM mutations are delivered — nothing under test relies on them.
    }

    disconnect(): void {
      // Nothing was observed, so nothing to release.
    }

    takeRecords(): MutationRecord[] {
      return [];
    }
  }
  vi.stubGlobal('MutationObserver', NoopMutationObserver);
}
