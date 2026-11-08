/**
 * Classifier probes — run ONLY in a child Vitest process by
 * test/selftest/classifier.test.js, which asserts the outcome of each one.
 * Every probe is a real discrepancy() registration; titles are the keys.
 * Exactly the probes named "EXPECTED…" may pass.
 */
import { expect } from 'vitest';
import fc from 'fast-check';
import { useApp } from '../../harness/useApp.js';
import { discrepancy } from '../../harness/discrepancy.js';
import { checkProperty, defineProperty, runScenario } from '../../harness/scenario.js';

const ctx = useApp();
const CP = 'final-observation';

/** The real DISC-03 Monster-playoff scenario; `fault` runs right before the prerequisite match. */
function disc03(disc, fault = () => {}) {
  const { d, app } = ctx;
  const ids = d.addPlayers(8);
  const t = d.createTournament({ type: 'monster', tables: 2 });
  d.addToEvent(t, ids);
  for (let i = 0; i < 2; i++) { d.generateRound(t); d.playRound(t); }
  d.startPlayoffs(t);
  const m = d.readyBracketMatches(t)[0];
  expect(m, 'setup: a ready playoff match').toBeTruthy();
  fault(app);
  d.playBracketMatch(t, m, true);
  expect(m.winner, 'setup: the playoff match was won by side a').toBe('a');
  app.call('openPlayoffScore', m.id);
  app.call('closeScoreModal');
  disc.observe(CP, () => expect(m.winner).toBe('a'));
}

const tinyProp = (run) => defineProperty({
  id: 'probe-prop', title: 'probe', arbitrary: fc.record({ seed: fc.integer({ min: 1, max: 1000 }) }),
  defaultRuns: 3, caseBudgetMs: 20_000, run,
});

// ---- the only probes allowed to pass ----
discrepancy('PROBE', 'EXPECTED: real DISC-03 reproduces at its checkpoint', { checkpoint: CP }, (disc) => disc03(disc));

discrepancy('PROBE', 'EXPECTED: observation inside a property case (fast-check wrapped)', { checkpoint: CP },
  (disc) => checkProperty(tinyProp(({ disc: dd }) => dd.observe(CP, () => expect(1).toBe(2))), { disc }));

discrepancy('PROBE', 'EXPECTED: async observation', { checkpoint: CP }, async (disc) => {
  await disc.observe(CP, async () => { await Promise.resolve(); expect('a').toBe('b'); });
});

discrepancy('PROBE', 'EXPECTED: allowed page error', { checkpoint: CP, allowPageErrors: [/deliberate allowed error/] }, (disc) => {
  ctx.app.window.console.error('deliberate allowed error');
  disc.observe(CP, () => expect(1).toBe(2));
});

// ---- every probe below MUST FAIL ----
discrepancy('PROBE', 'FAIL setup: submitScore no-op before the prerequisite match (review F1 repro)', { checkpoint: CP },
  (disc) => disc03(disc, (app) => app.eval('submitScore = function () {}')));

discrepancy('PROBE', 'FAIL setup: unrelated assertion before the checkpoint', { checkpoint: CP }, (disc) => {
  expect(ctx.app.state.players.length, 'unrelated setup check').toBe(99);
  disc.observe(CP, () => expect(1).toBe(2));
});

discrepancy('PROBE', 'FAIL cleanup: unrelated assertion after the checkpoint passed', { checkpoint: CP }, (disc) => {
  disc.observe(CP, () => expect(1).toBe(1));
  expect('cleanup').toBe('broken');
});

discrepancy('PROBE', 'FAIL crash: plain TypeError', { checkpoint: CP }, () => {
  null.x; // eslint-disable-line no-unused-expressions
});

discrepancy('PROBE', 'FAIL crash: TypeError whose cause is an AssertionError', { checkpoint: CP }, () => {
  let inner; try { expect(1).toBe(2); } catch (e) { inner = e; }
  throw new TypeError('wrapper', { cause: inner });
});

discrepancy('PROBE', 'FAIL crash: TypeError whose cause is a genuine observation', { checkpoint: CP }, (disc) => {
  let obs; try { disc.observe(CP, () => expect(1).toBe(2)); } catch (e) { obs = e; }
  throw new TypeError('wrapper', { cause: obs });
});

discrepancy('PROBE', 'FAIL crash: error message mentioning AssertionError', { checkpoint: CP }, () => {
  throw new Error('Property failed after 1 tests\nAssertionError: looks like an assertion');
});

discrepancy('PROBE', 'FAIL crash: TypeError inside observe()', { checkpoint: CP }, (disc) => {
  disc.observe(CP, () => { null.x; }); // eslint-disable-line no-unused-expressions
});

discrepancy('PROBE', 'FAIL pass: invariant holds (no longer reproduces)', { checkpoint: CP }, (disc) => {
  disc.observe(CP, () => expect(1).toBe(1));
});

discrepancy('PROBE', 'FAIL pass: checkpoint never reached', { checkpoint: CP }, () => {});

discrepancy('PROBE', 'FAIL wrong checkpoint name', { checkpoint: CP }, (disc) => {
  disc.observe('some-other-checkpoint', () => expect(1).toBe(2));
});

discrepancy('PROBE', 'FAIL observation from another discrepancy id', { checkpoint: CP }, async () => {
  const { makeObserver } = await import('../../harness/discrepancy.js');
  makeObserver('PROBE-OTHER', CP).observe(CP, () => expect(1).toBe(2));
});

discrepancy('PROBE', 'FAIL property: unrelated assertion in a case', { checkpoint: CP },
  (disc) => checkProperty(tinyProp(() => expect('setup').toBe('ok')), { disc }));

discrepancy('PROBE', 'FAIL property: TypeError in a case', { checkpoint: CP },
  (disc) => checkProperty(tinyProp(() => { null.x; }), { disc })); // eslint-disable-line no-unused-expressions

discrepancy('PROBE', 'FAIL property: page error in the observing case', { checkpoint: CP },
  (disc) => checkProperty(tinyProp(({ app, disc: dd }) => {
    app.window.console.error('unexpected app error');
    dd.observe(CP, () => expect(1).toBe(2));
  }), { disc }));

discrepancy('PROBE', 'FAIL page error alongside a genuine observation', { checkpoint: CP }, (disc) => {
  ctx.app.window.console.error('unexpected app error');
  disc.observe(CP, () => expect(1).toBe(2));
});

discrepancy('PROBE', 'FAIL scenario: page error alongside observation (runScenario)', { checkpoint: CP },
  (disc) => runScenario({ seed: 1 }, ({ app }) => {
    app.window.console.error('unexpected app error');
    disc.observe(CP, () => expect(1).toBe(2));
  }));

discrepancy('PROBE', 'FAIL timeout: body never settles', { checkpoint: CP, timeout: 300 },
  () => new Promise(() => {}));
