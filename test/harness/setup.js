/**
 * Global Vitest setup (vitest.config.js → setupFiles). Enforces test isolation at
 * every test boundary, whatever fixture a test uses:
 *   - the fabricated-player id counter restarts at p_0001 for every test;
 *   - a test that leaves a jsdom window open FAILS (the window is closed so the
 *     leak cannot reach the next test). Windows are per-test by construction
 *     (useApp / runScenario / explicit boot + afterEach close).
 */
import { beforeEach, afterEach } from 'vitest';
import { openApps } from './loadApp.js';
import { resetIds } from '../factories/players.js';
import { activeFaults } from './faults.js';

if (activeFaults().length) {
  // Loud on purpose: a fault makes tests fail; it must never be left on by accident.
  console.warn(`\n*** LCFC_FAULT active: ${activeFaults().join(', ')} — the app is deliberately broken in this run ***\n`);
}

beforeEach(() => {
  resetIds();
});

afterEach(() => {
  const leaked = openApps();
  for (const app of leaked) app.close();
  if (leaked.length) {
    throw new Error(`ISOLATION: ${leaked.length} jsdom window(s) were left open by this test. ` +
      'Close every window you boot (useApp and runScenario do this for you).');
  }
});
