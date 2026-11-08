import { beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { loadApp } from './loadApp.js';
import { createDriver } from '../factories/driver.js';
import { resetIds } from '../factories/players.js';

/**
 * Vitest helper. `fresh: true` boots a new window per test (strongest isolation);
 * otherwise one window per file is reused and reset between tests (fast).
 */
export function useApp({ fresh = false, seed = 1, ...loadOpts } = {}) {
  const ctx = {};
  if (fresh) {
    beforeEach(async () => {
      resetIds();
      ctx.app = await loadApp({ seed, ...loadOpts });
      ctx.d = createDriver(ctx.app, { seed });
    });
    afterEach(() => ctx.app?.close());
  } else {
    beforeAll(async () => { ctx.app = await loadApp({ seed, ...loadOpts }); });
    beforeEach(() => {
      resetIds();
      ctx.app.reset({ seed });
      ctx.d = createDriver(ctx.app, { seed });
    });
    afterAll(() => ctx.app?.close());
  }
  return ctx;
}
