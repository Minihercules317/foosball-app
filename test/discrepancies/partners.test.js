/**
 * DISCREPANCY — partner rotation optimality. Requires domain-owner review (AUDIT DISC-15).
 *
 * README: "Partner draws avoid repeat partners until the field has cycled."
 * The app uses up to 120 randomized greedy trials (fairPairPlayers). Once repeats
 * become unavoidable it may draw MORE repeat partnerships than the exact optimum
 * for the same players. Repeat-free draws (the common case) are always found —
 * see test/properties/partners.property.test.js.
 */
import { describe, expect } from 'vitest';
import fc from 'fast-check';
import { useApp } from '../harness/useApp.js';
import { fcParams } from '../harness/fcConfig.js';
import { exploratory } from '../harness/discrepancy.js';
import { replayNight, longNight } from '../factories/scenarios.js';
import { measureRematches } from '../factories/oracles.js';

const ctx = useApp();
const replay = (script, cb) => { ctx.app.reset({ seed: script.seed }); return replayNight(ctx.app, ctx.d, script, cb); };

describe('DISC-15 partner draws use the fewest possible repeat partnerships', () => {
  exploratory('DISC-15', 'never more repeat partnerships than the exact optimum (random long nights)', () => {
    fc.assert(fc.property(longNight, (script) => {
      for (const row of measureRematches(replay, script)) {
        expect(row.actual, `round ${row.round}: ${row.actual} repeats, optimum ${row.optimal} (${row.players} players)`).toBeLessThanOrEqual(row.optimal);
      }
    }), fcParams(60));
  });
});
