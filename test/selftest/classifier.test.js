/**
 * SELF-TEST (review F1): the expected-failure classifier fails when it should. Every probe runs in a CHILD Vitest process
 * (./nested.js), so this file observes real registered-test outcomes —
 * including timeouts — without itself going red.
 *
 *  1. Classifier probes (probes/classifier.probe.js): only the "EXPECTED" probes
 *     pass; unrelated assertions, exceptions (also with assertion causes),
 *     unexpected passes, unreached/wrong checkpoints, page errors and timeouts
 *     all fail with an actionable message.
 *  2. Fault injection into the REAL discrepancy suite (LCFC_FAULT, test/harness/faults.js)
 *     with submitScore broken: the real DISC-03 tests turn red as UNEXPECTED (and
 *     pass without the fault), and only the five discrepancies that never score a
 *     match may still count as reproduced — every other one fails with a label.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runVitest } from './nested.js';

const PROBES = 'test/selftest/probes/vitest.probes.config.js';

describe('classifier probes (child process)', () => {
  let run;
  beforeAll(async () => {
    run = await runVitest({ config: PROBES, files: ['test/selftest/probes/classifier.probe.js'] });
  }, 120_000);

  const outcome = (title) => {
    const t = run.tests.get(`[PROBE] ${title}`);
    if (!t) throw new Error(`probe not found: ${title}\nknown: ${[...run.tests.keys()].join('\n')}\n${run.stdout.slice(-2000)}`);
    return t;
  };

  it('only the EXPECTED probes pass', () => {
    const passed = [...run.tests].filter(([, t]) => t.status === 'passed').map(([k]) => k).sort();
    expect(passed).toEqual([
      '[PROBE] EXPECTED: allowed page error',
      '[PROBE] EXPECTED: async observation',
      '[PROBE] EXPECTED: observation inside a property case (fast-check wrapped)',
      '[PROBE] EXPECTED: real DISC-03 reproduces at its checkpoint',
    ]);
    expect(run.tests.size).toBe(22);
    expect(run.code).not.toBe(0);
  });

  const mustFail = {
    'FAIL setup: submitScore no-op before the prerequisite match (review F1 repro)': ['UNEXPECTED FAILURE', 'an assertion OUTSIDE the declared checkpoint', 'setup: the playoff match was won by side a'],
    'FAIL setup: unrelated assertion before the checkpoint': ['UNEXPECTED FAILURE', 'an assertion OUTSIDE', 'unrelated setup check'],
    'FAIL cleanup: unrelated assertion after the checkpoint passed': ['UNEXPECTED FAILURE', 'an assertion OUTSIDE'],
    'FAIL crash: plain TypeError': ['UNEXPECTED FAILURE', 'a TypeError was thrown'],
    'FAIL crash: TypeError whose cause is an AssertionError': ['UNEXPECTED FAILURE', 'a TypeError was thrown'],
    'FAIL crash: TypeError whose cause is a genuine observation': ['UNEXPECTED FAILURE', 'a TypeError was thrown'],
    'FAIL crash: error message mentioning AssertionError': ['UNEXPECTED FAILURE', 'a Error was thrown'],
    'FAIL crash: TypeError inside observe()': ['UNEXPECTED FAILURE', 'a TypeError was thrown'],
    'FAIL pass: invariant holds (no longer reproduces)': ['DISCREPANCY NO LONGER REPRODUCES'],
    'FAIL pass: checkpoint never reached': ['CHECKPOINT NEVER REACHED'],
    'FAIL wrong checkpoint name': ['UNEXPECTED FAILURE', "does not match the declared checkpoint"],
    'FAIL observation from another discrepancy id': ['UNEXPECTED FAILURE', 'observation from a different discrepancy'],
    'FAIL property: unrelated assertion in a case': ['UNEXPECTED FAILURE', 'property case failed somewhere other than the declared checkpoint', 'fast-check seed='],
    'FAIL property: TypeError in a case': ['UNEXPECTED FAILURE', 'property case failed somewhere other than the declared checkpoint'],
    'FAIL property: page error in the observing case': ['UNEXPECTED FAILURE', 'UNEXPECTED PAGE ERRORS', 'unexpected app error'],
    'FAIL page error alongside a genuine observation': ['UNEXPECTED PAGE ERRORS', 'unexpected app error'],
    'FAIL scenario: page error alongside observation (runScenario)': ['UNEXPECTED FAILURE', 'UNEXPECTED PAGE ERRORS', 'unexpected app error'],
  };
  for (const [title, fragments] of Object.entries(mustFail)) {
    it(`fails: ${title}`, () => {
      const t = outcome(title);
      expect(t.status, t.message).toBe('failed');
      for (const f of fragments) expect(t.message).toContain(f);
    });
  }
  it('fails: FAIL timeout: body never settles (Vitest timeout is not caught)', () => {
    expect(outcome('FAIL timeout: body never settles').status).toBe('failed');
    expect(run.stdout).toMatch(/FAIL timeout: body never settles[\s\S]*Test timed out in 300ms/);
  });
  it('the setup-fault probe did not reach the cancel path (failure is in setup, not the observation)', () => {
    expect(outcome('FAIL setup: submitScore no-op before the prerequisite match (review F1 repro)').message).not.toContain('DiscrepancyObserved');
  });
});

describe('fault injection into the real discrepancy suite (child process)', () => {
  const runs = {};
  beforeAll(async () => {
    [runs.fault, runs.disc03Clean] = await Promise.all([
      runVitest({ files: ['test/discrepancies'], env: { LCFC_FAULT: 'noop-submitScore' } }),
      runVitest({ files: ['test/discrepancies/bracket-corrections.test.js'], filter: 'DISC-03' }),
    ]);
  }, 300_000);

  const ran = (r) => [...r.tests.values()].filter((t) => t.status !== 'skipped');
  const isDisc03 = (t) => t.fullName.includes('[DISC-03]');

  it('DISC-03 with submitScore broken: every DISC-03 test fails as UNEXPECTED (none counts as the known finding)', () => {
    const tests = ran(runs.fault).filter(isDisc03);
    expect(tests).toHaveLength(3);
    for (const t of tests) {
      expect(t.status, t.fullName).toBe('failed');
      expect(t.message).toContain('UNEXPECTED FAILURE');
    }
  });
  it('positive control: the same DISC-03 tests pass without the fault', () => {
    const tests = ran(runs.disc03Clean);
    expect(tests).toHaveLength(3);
    for (const t of tests) expect(t.status, t.message).toBe('passed');
  });
  it('with scoring broken, ONLY the discrepancies that never score a match still count as reproduced', () => {
    const stillReproduce = ran(runs.fault).filter((t) => t.status === 'passed').map((t) => t.fullName.replace(/^.*?(\[DISC-\d+\])/, '$1').slice(0, 60)).sort();
    expect(stillReproduce).toEqual([
      '[DISC-08] app still finishes booting with a null tournament ',
      '[DISC-08] app still finishes booting with a numeric tourname',
      '[DISC-08] app still finishes booting with a tournament witho',
      '[DISC-10] a crafted player id cannot inject markup into the ',
      '[DISC-13] generating the next round before the current one f',
    ]);
  });
  it('every other discrepancy fails, with a classifier label rather than a bare error', () => {
    const all = ran(runs.fault);
    const failed = all.filter((t) => t.status === 'failed');
    expect(failed.length + 5, 'each test either still reproduces (the 5 above) or failed').toBe(all.length);
    expect(failed.length).toBeGreaterThan(15);
    for (const t of failed) expect(t.message, t.fullName).toMatch(/UNEXPECTED FAILURE|NO LONGER REPRODUCES|CHECKPOINT NEVER REACHED/);
  });
});
