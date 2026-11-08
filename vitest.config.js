import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    exclude: ['test/e2e/**', 'node_modules/**', 'test/scratch/**'],
    environment: 'node', // each test boots its own jsdom window via test/harness/loadApp.js
    testTimeout: 300_000,
    hookTimeout: 60_000,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
});
