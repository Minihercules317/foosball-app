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
 * round 10 — that frequency is from the original audit and was not independently
 * replicated). The scenario fixtures in test/fixtures/scenarios/ reproduce
 * deterministically, each in its own fresh window: round 10 seats 4 players whose pairings are
 *   chosen   : A+B (2nd time), C+D (2nd time)          → 2 repeats, 2 "forbidden"
 *   available: A+C (3rd time), B+D (new)               → 1 repeat,  1 "forbidden"
 * i.e. worse by the app's own comparison metrics, but arguably a more even spread.
 */
import { describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { runScenario, checkProperty, propertyTimeoutMs } from '../harness/scenario.js';
import { discrepancy, exploratory } from '../harness/discrepancy.js';
import { disc15Exploration, DISC15_CHECKPOINT } from './defs.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/scenarios/${name}`, import.meta.url), 'utf8'));
const PINNED = ['DISC-15-seed-4000099.json', 'DISC-15-seed-6000155.json'].map(fixture);

describe('DISC-15 partner draws use the fewest possible repeat partnerships', () => {
  for (const fx of PINNED) {
    discrepancy('DISC-15', `7 players, 10 rounds (seed ${fx.scenario.seed}): never more repeat partnerships than the exact optimum`,
      { checkpoint: DISC15_CHECKPOINT },
      (disc) => runScenario(fx.scenario, (c) => disc15Exploration.run({ ...c, disc })));
  }

  // Stress workflow only (EXPLORE=1). Run count from PROP_RUNS (default 40).
  exploratory('DISC-15', 'never more repeat partnerships than the exact optimum (random long nights)',
    { checkpoint: DISC15_CHECKPOINT, timeout: propertyTimeoutMs(disc15Exploration) },
    (disc) => checkProperty(disc15Exploration, { disc }));
});
