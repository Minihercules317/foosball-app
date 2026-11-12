/**
 * DISCREPANCIES — bracket score corrections. Requires domain-owner review.
 * See docs/AUDIT.md (DISC-01). These tests assert PROPOSED invariants and are expected
 * to fail against the current index.html AT THEIR DECLARED CHECKPOINT; see
 * test/harness/discrepancy.js for how they are classified.
 *
 * v7.34 (upstream 4b9127e) resolved DISC-02 … DISC-05 and the single-elim-8 / seed-8
 * instances of DISC-01. Those checks now live, unchanged in scenario and assertions, in
 * test/regression/resolved-discrepancies.test.js. DISC-01 stays OPEN: the random property
 * still finds double-booking after a correction (pinned below as a saved scenario).
 */
import { describe } from 'vitest';
import { checkProperty, runScenario } from '../harness/scenario.js';
import { discrepancy } from '../harness/discrepancy.js';
import { disc01Correction, DISC01_CHECKPOINT } from './defs.js';
import { readFileSync } from 'node:fs';

/** Saved counterexample (scenario fixture) found by the DISC-01 property against v7.34; replays alone. */
const DISC01_FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/scenarios/DISC-01-correction.json', import.meta.url), 'utf8'));

describe('DISC-01 correcting a bracket result keeps the bracket structurally valid', () => {
  discrepancy('DISC-01', 'after flipping an earlier result, no player is in two ready matches (random brackets)',
    { checkpoint: DISC01_CHECKPOINT },
    (disc) => checkProperty(disc01Correction, { disc }));

  discrepancy('DISC-01', `saved scenario ${JSON.stringify(DISC01_FIXTURE.scenario)}: no player is in two ready matches after the correction`,
    { checkpoint: DISC01_CHECKPOINT },
    (disc) => runScenario(DISC01_FIXTURE.scenario, (c) => disc01Correction.run({ ...c, disc })));
});
