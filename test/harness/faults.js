/**
 * Named, TEST-ONLY fault injections. They exist to prove that the suite turns red
 * when the app misbehaves (self-tests in test/selftest/ run real test files with
 * a fault enabled and require them to FAIL). index.html on disk is never touched:
 * a fault only replaces a function inside one jsdom window, after boot.
 *
 * Enable with LCFC_FAULT=<name>[,<name>...]. With no LCFC_FAULT set, nothing happens.
 */
export const FAULTS = {
  /** submitScore does nothing (scores are silently dropped). */
  'noop-submitScore': (app) => { app.eval('submitScore = function () {}'); },
  /** Opening the Ranking stats tab crashes; every other tab works. */
  'throw-statsTab-ranking': (app) => {
    app.eval(`(function () {
      const orig = setStatsTab;
      setStatsTab = function (tab) {
        if (tab === 'ranking') throw new TypeError('injected fault: ranking tab crashed');
        return orig.apply(this, arguments);
      };
    })()`);
  },
  /** The player list renders nothing (a silently broken view). */
  'blank-renderPlayers': (app) => { app.eval('renderPlayers = function () {}'); },
};

export function activeFaults() {
  const raw = process.env.LCFC_FAULT || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function applyFaults(app) {
  for (const name of activeFaults()) {
    const fault = FAULTS[name];
    if (!fault) throw new Error(`LCFC_FAULT: unknown fault "${name}" (known: ${Object.keys(FAULTS).join(', ')})`);
    fault(app);
  }
}
