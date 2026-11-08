/**
 * Property: Monster DYP partner draws avoid repeat partners when possible.
 *
 * README: "Partner draws avoid repeat partners until the field has cycled".
 * Oracle: an exact solver (test/factories/oracles.js#minRematches) computes the
 * fewest repeat partnerships achievable for the players actually drawn in a
 * round (sit-outs are decided first, so we judge pairing given those sitters).
 *
 * The stronger claim "never more repeats than the optimum" is violated rarely and
 * lives in test/discrepancies/partners.test.js (DISC-15).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { useApp } from '../harness/useApp.js';
import { fcParams } from '../harness/fcConfig.js';
import { replayNight, longNight } from '../factories/scenarios.js';
import { measureRematches } from '../factories/oracles.js';

const ctx = useApp();
const replay = (script, cb) => { ctx.app.reset({ seed: script.seed }); return replayNight(ctx.app, ctx.d, script, cb); };

describe('partner rotation (Monster DYP)', () => {
  it('no repeat partner whenever a repeat-free draw exists', () => {
    fc.assert(fc.property(longNight, (script) => {
      for (const row of measureRematches(replay, script)) {
        if (row.optimal === 0) {
          expect(row.actual, `round ${row.round}: repeat partner although a repeat-free draw existed`).toBe(0);
        }
      }
    }), fcParams(15));
  });
});
