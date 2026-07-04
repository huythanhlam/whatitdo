import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve the `@/*` tsconfig path alias natively (no plugin needed).
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // PGlite-backed integration tests share one in-memory DB per file via the
    // globalThis singleton; keep files isolated but don't fork per test.
    pool: 'forks',
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
