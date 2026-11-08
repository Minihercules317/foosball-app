/**
 * Replay ONE saved scenario, alone, in a fresh process:
 *   npm run replay -- <fixture.json>
 * The fixture is either a failure report written by test/harness/scenario.js
 * (test-results/scenarios/*.json) or a committed fixture (test/fixtures/scenarios/*.json);
 * both carry `property` (a test/harness/registry.js id) and `scenario`.
 * The case runs exactly as inside its property: fresh window, fresh driver, ids from
 * p_0001, streams seeded from scenario.seed. For a discrepancy fixture
 * (`discrepancy` + `checkpoint` fields) the observation is tagged, so a reproduced
 * discrepancy FAILS printing "[DISC-xx @ checkpoint] …".
 * Without SCENARIO_FILE (e.g. in npm test) this file is skipped.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROPERTIES } from '../harness/registry.js';
import { runScenario, PLAIN_OBSERVER, propertyTimeoutMs } from '../harness/scenario.js';
import { makeObserver } from '../harness/discrepancy.js';

const file = process.env.SCENARIO_FILE;

describe.runIf(!!file)('replay a saved scenario', () => {
  const fx = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const def = PROPERTIES[fx.property];
  it(`${fx.property}: ${JSON.stringify(fx.scenario)}`, async () => {
    if (!def) throw new Error(`unknown property "${fx.property}" in ${file} (known: ${Object.keys(PROPERTIES).join(', ')})`);
    console.log(`[replay] ${fx.property} scenario=${JSON.stringify(fx.scenario)}`);
    const disc = fx.discrepancy && fx.checkpoint ? makeObserver(fx.discrepancy, fx.checkpoint) : PLAIN_OBSERVER;
    await runScenario(fx.scenario, (c) => def.run({ ...c, disc }),
      { appOptions: def.appOptions, allowPageErrors: def.allowPageErrors });
  }, def ? propertyTimeoutMs({ ...def, defaultRuns: 1 }) : 60_000);
});
