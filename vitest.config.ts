import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 80,
        statements: 80,
      },
    },
    include: [
      'src/__tests__/**/*.spec.ts',
      // v0.96.0 i18n module uses colocated `src/i18n/__tests__/*.test.ts`.
      // Pattern extended to pick up sub-module test folders without forcing
      // a flat layout for every future feature.
      'src/**/__tests__/**/*.test.ts',
    ],
  },
})
