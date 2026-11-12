/**
 * DISCREPANCY — partner rotation optimality (AUDIT DISC-15). Low severity; whether the
 * app's choice is actually worse is a CLUB-RULES QUESTION for the owner.
 *
 * README: "Partner draws avoid repeat partners until the field has cycled."
 * Proposed invariant: a round never uses more repeat partnerships than the exact optimum
 * for the players seated (bitmask DP in test/factories/oracles.js).
 *
 * History: found by a bounded randomized search against v7.28–v7.37 (2 of 1,925 random long
 * nights, both 7 players, round 10; audit estimate, not independently replicated). v7.37's
 * greedy builder always took a player's lowest-count partner first, so it could never produce
 * a pairing that needs a THIRD partnership even when that pairing has fewer repeats overall:
 *   chosen   : A+B (2nd time), C+D (2nd time)          → 2 repeats
 *   available: A+C (3rd time), B+D (new)               → 1 repeat
 *
 * v7.42 (2026-11-12) replaced the draw (exact search for fields of ≤ 10, consecutive-partner
 * rules, new sit-out ring). Both pinned counterexamples no longer reproduce, including their
 * exact v7.37 round-10 histories, and they are now regression tests
 * (test/regression/resolved-discrepancies-v742.test.js). v7.42's exact search ranks
 * CONSECUTIVE partnerships before total repeats, so the invariant is not guaranteed by
 * construction. The exploration below therefore keeps looking for NEW counterexamples. It does
 * not depend on the old ones still reproducing: finding none passes, and a new instance is
 * recorded and reported (exploratory() in test/harness/discrepancy.js). It never fails the run.
 */
import { describe } from 'vitest';
import { checkProperty, propertyTimeoutMs } from '../harness/scenario.js';
import { exploratory } from '../harness/discrepancy.js';
import { disc15Exploration, DISC15_CHECKPOINT } from './defs.js';

describe('DISC-15 partner draws use the fewest possible repeat partnerships', () => {
  // Stress workflow only (EXPLORE=1). Run count from PROP_RUNS (default 40).
  exploratory('DISC-15', 'never more repeat partnerships than the exact optimum (random long nights)',
    { checkpoint: DISC15_CHECKPOINT, timeout: propertyTimeoutMs(disc15Exploration) },
    (disc) => checkProperty(disc15Exploration, { disc }));
});
