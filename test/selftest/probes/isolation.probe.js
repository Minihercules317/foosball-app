/**
 * Isolation guard probe — run ONLY in a child Vitest process by
 * test/selftest/isolation.test.js. A test that leaves a window open must fail.
 */
import { it, expect } from 'vitest';
import { loadApp } from '../../harness/loadApp.js';

it('FAIL leaks an open window', async () => {
  const app = await loadApp();
  expect(app.closed).toBe(false); // deliberately not closed
});

it('PASS closes its window', async () => {
  const app = await loadApp();
  app.close();
  expect(app.closed).toBe(true);
});
