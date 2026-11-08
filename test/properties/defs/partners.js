/**
 * Property definition: Monster DYP partner draws avoid repeat partners when possible.
 *
 * README: "Partner draws avoid repeat partners until the field has cycled".
 * Oracle: an exact solver (test/factories/oracles.js#minRematches) computes the
 * fewest repeat partnerships achievable for the players actually drawn in a
 * round (sit-outs are decided first, so we judge pairing given those sitters).
 * The stronger claim "never more repeats than the optimum" is violated rarely and
 * lives in test/discrepancies/partners.test.js (DISC-15).
 */
import { expect } from 'vitest';
import { defineProperty } from '../../harness/scenario.js';
import { replayNight, longNight } from '../../factories/scenarios.js';
import { measureRematches } from '../../factories/oracles.js';

export const partnersRepeatFree = defineProperty({
  id: 'partners-repeat-free',
  title: 'no repeat partner whenever a repeat-free draw exists',
  arbitrary: longNight,
  defaultRuns: 15,
  caseBudgetMs: 8_000, // measured 150 cases: avg 1.6 s, slowest 5.6 s
  run({ app, d, scenario }) {
    for (const row of measureRematches((s, cb) => replayNight(app, d, s, cb), scenario)) {
      if (row.optimal === 0) {
        expect(row.actual, `round ${row.round}: repeat partner although a repeat-free draw existed`).toBe(0);
      }
    }
  },
});
