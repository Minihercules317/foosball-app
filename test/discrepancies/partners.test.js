/**
 * DISCREPANCY — partner rotation optimality (AUDIT DISC-15). Low severity; whether the
 * app's choice is actually worse is a CLUB-RULES QUESTION for the owner.
 *
 * README: "Partner draws avoid repeat partners until the field has cycled."
 * fairPairPlayers keeps the best of up to 120 randomized greedy pairings, compared by
 * (forbidden repeats, rematches, total prior count). The greedy builder always takes a
 * player's lowest-count partner first, so it can never produce a pairing that needs a
 * THIRD partnership even when that pairing has fewer repeats overall.
 *
 * Found by a bounded randomized search (2 of 1,925 random long nights; both 7 players,
 * round 10). The seeds
 * below reproduce deterministically: round 10 seats 4 players whose pairings are
 *   chosen   : A+B (2nd time), C+D (2nd time)          → 2 repeats, 2 "forbidden"
 *   available: A+C (3rd time), B+D (new)               → 1 repeat,  1 "forbidden"
 * i.e. worse by the app's own comparison metrics, but arguably a more even spread.
 */
import { describe, expect } from 'vitest';
import fc from 'fast-check';
import { useApp } from '../harness/useApp.js';
import { fcParams } from '../harness/fcConfig.js';
import { discrepancy, exploratory } from '../harness/discrepancy.js';
import { replayNight, longNight } from '../factories/scenarios.js';
import { measureRematches } from '../factories/oracles.js';
import { createDriver } from '../factories/driver.js';
import { resetIds } from '../factories/players.js';

const ctx = useApp();
/** Replay exactly as the search did: app and driver both seeded with the script seed. */
const replay = (script, cb) => {
  resetIds();
  ctx.app.reset({ seed: script.seed });
  return replayNight(ctx.app, createDriver(ctx.app, { seed: script.seed }), script, cb);
};
const tenRounds = (seed) => ({ seed, type: 'monster', players: 7, tables: 2, ops: Array.from({ length: 10 }, () => ({ op: 'round' })) });

describe('DISC-15 partner draws use the fewest possible repeat partnerships', () => {
  for (const seed of [4000099, 6000155]) {
    discrepancy('DISC-15', `7 players, 10 rounds (seed ${seed}): never more repeat partnerships than the exact optimum`, () => {
      for (const row of measureRematches(replay, tenRounds(seed))) {
        expect(row.actual, `round ${row.round}: ${row.actual} repeats, optimum ${row.optimal}`).toBeLessThanOrEqual(row.optimal);
      }
    });
  }

  exploratory('DISC-15', 'never more repeat partnerships than the exact optimum (random long nights)', () => {
    fc.assert(fc.property(longNight, (script) => {
      for (const row of measureRematches(replay, script)) {
        expect(row.actual, `round ${row.round}: ${row.actual} repeats, optimum ${row.optimal} (${row.players} players)`).toBeLessThanOrEqual(row.optimal);
      }
    }), fcParams(40));
  }, 900_000);
});
