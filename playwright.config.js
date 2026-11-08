import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level tests against the real index.html served statically.
 * The Tailwind / Chart.js CDNs are loaded for real (as on GitHub Pages);
 * data/latest.json is always intercepted with SYNTHETIC data — never the real file.
 */
export default defineConfig({
  testDir: 'test/e2e',
  // Own subfolder: Playwright empties its outputDir on every run, and test-results/
  // also holds Vitest's scenario fixtures and property-run records.
  outputDir: 'test-results/playwright',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node scripts/serve.mjs 4173',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
