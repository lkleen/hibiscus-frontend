import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Restrict discovery to source specs — without this, a stale `dist/` from `pnpm build`
    // (which compiles *.spec.ts to CommonJS *.spec.js since specs aren't excluded from the
    // production tsconfig's `include`) gets picked up too and fails to import under Vitest.
    include: ['src/**/*.spec.ts'],
  },
});
