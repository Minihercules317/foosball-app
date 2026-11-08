import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    exclude: ['test/e2e/**', 'node_modules/**', 'test/scratch/**', 'test/selftest/probes/**'],
    environment: 'node', // each test boots its own jsdom window via test/harness/loadApp.js
    setupFiles: ['test/harness/setup.js'], // isolation guard at every test boundary
    // Ordinary tests. Property tests set their own timeout from their measured
    // per-case budget × run count (test/harness/scenario.js), so PROP_RUNS=150
    // exploration is not cut off by this default (review F5).
    testTimeout: 300_000,
    hookTimeout: 60_000,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
});
