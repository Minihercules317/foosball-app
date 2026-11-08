import { defineConfig } from 'vitest/config';
// Only for test/selftest/*.test.js, which run these probes in a child process.
export default defineConfig({
  test: {
    include: ['test/selftest/probes/**/*.probe.js'],
    setupFiles: ['test/harness/setup.js'],
    testTimeout: 60_000,
  },
});
