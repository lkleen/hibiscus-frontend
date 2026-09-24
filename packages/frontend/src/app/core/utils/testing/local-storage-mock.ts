/**
 * This test environment's `window` is aliased to Node's global scope, whose own experimental
 * `localStorage` is disabled without a CLI flag — there's no real browser-backed store to use.
 * Installs a fresh in-memory `Storage` on `window.localStorage` for a single test.
 */
export function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mock: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
}
