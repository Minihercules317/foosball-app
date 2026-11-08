import { beforeEach, afterEach } from 'vitest';
import { loadApp } from './loadApp.js';
import { createDriver } from '../factories/driver.js';
import { resetIds } from '../factories/players.js';

/**
 * Vitest fixture: EVERY test gets a freshly booted window (fresh app state,
 * settings, storage, timers, listeners and globals), a fresh driver whose random
 * stream starts at `seed`, and player ids restarting at p_0001. The window is
 * closed after the test. There is no shared-window mode: the previous in-place
 * reset leaked settings, modal state and substituted functions (review F3).
 *
 * Property tests must not reuse `ctx.app` across generated cases — use
 * test/harness/scenario.js, which boots a fresh window per case.
 */
export function useApp({ seed = 1, ...loadOpts } = {}) {
  const ctx = {};
  beforeEach(async () => {
    resetIds();
    ctx.app = await loadApp({ seed, ...loadOpts });
    ctx.d = createDriver(ctx.app, { seed });
  });
  afterEach(() => {
    ctx.app?.close();
    ctx.app = null;
    ctx.d = null;
  });
  return ctx;
}
