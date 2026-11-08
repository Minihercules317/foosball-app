/**
 * SELF-TEST (review F3): intentionally contaminated state cannot leak into the
 * next test or the next generated case.
 *
 * Test "A" contaminates everything the review found leaking through the old
 * in-place reset — bonus-split setting, active score-match reference, current
 * tab, substituted downloadJson — plus storage, globals, Math.random, an open
 * modal, scripted dialog answers, a live timer, event listeners, the id counter
 * and the driver's random stream. Test "B" (runs next, same file, same fixture)
 * and every case of a contaminating property must see a pristine app, compared
 * against an independently booted reference window.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { useApp } from '../harness/useApp.js';
import { loadApp, openApps, STORAGE_KEY } from '../harness/loadApp.js';
import { checkProperty, defineProperty } from '../harness/scenario.js';
import { makeRng, mulberry32 } from '../factories/random.js';
import { runVitest } from './nested.js';

const SEED = 1;
const ctx = useApp({ seed: SEED });

/** Node-side counters that a leaked timer / listener would keep incrementing. */
const leak = { timer: 0, storage: 0, click: 0 };

/** Observable state that must be identical in every fresh window. */
function fingerprint(app) {
  const w = app.window;
  const ls = {};
  for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); ls[k] = k === 'foosmanager_change_v1' ? '<timestamp>' : w.localStorage.getItem(k); }
  return {
    state: JSON.parse(JSON.stringify(app.state)),
    bonusSplit: app.eval('getBonusSplitMode()'),
    statsTab: app.eval('statsActiveTab'),
    downloadJson: app.eval('downloadJson.toString()'),
    submitScore: app.eval('submitScore.toString()'),
    contaminatedGlobal: typeof w.__contaminated,
    localStorage: ls,
    sessionStorageLength: w.sessionStorage.length,
    scoreModalHidden: w.document.getElementById('score-modal').classList.contains('hidden'),
    toasts: app.toasts().length,
    dialogsQueued: app.dialogs.confirm.length + app.dialogs.prompt.length,
    bodyClass: w.document.body.className,
  };
}

let reference;
beforeAll(async () => {
  const ref = await loadApp({ seed: SEED });
  reference = fingerprint(ref);
  ref.close();
});

/** Expect a pristine app + driver + ids, and no leaked timer/listener activity. */
async function expectPristine(app, d, { seed = SEED, alsoOpen = [] } = {}) {
  expect(fingerprint(app)).toEqual(reference);
  expect(app.window.Math.random(), 'Math.random restarted at the seed').toBe(mulberry32(seed)());
  expect(d.rng.next(), 'driver stream restarted at the seed').toBe(makeRng(seed).next());
  expect(d.addPlayers(1), 'player ids restarted').toEqual(['p_0001']);
  const before = { ...leak };
  app.window.dispatchEvent(new app.window.StorageEvent('storage', { key: STORAGE_KEY }));
  app.window.document.body.click();
  await new Promise((r) => setTimeout(r, 40)); // a leaked 5 ms interval would fire ~8 times
  expect(leak, 'no timer or listener from an earlier window is still running').toEqual(before);
  const strangers = openApps().filter((a) => a !== app && !alsoOpen.includes(a)).length;
  expect(strangers, 'no window from an earlier test/case is still open').toBe(0);
}

/** Contaminate one app as thoroughly as we can from outside index.html. */
function contaminate(app, d) {
  const w = app.window;
  const ids = d.addPlayers(8);
  const t = d.createTournament({ type: 'monster', tables: 2 });
  d.addToEvent(t, ids);
  const r = d.generateRound(t);
  app.call('setBonusSplitMode', '60-30-10');                       // setting (localStorage)
  app.call('openScoreModal', r.number, r.matches[0].id);             // active match ref + open modal
  app.state.currentTab = 'bracket';                                  // view state
  app.eval('statsActiveTab = "awards"');                            // top-level let
  app.eval('downloadJson = function () { throw new Error("contaminated"); }'); // substituted function
  app.eval('submitScore = function () {}');
  w.__contaminated = true;                                           // window global
  w.Math.random = () => 0.5;                                         // RNG substitution
  w.sessionStorage.setItem('x', 'y');
  w.document.body.classList.add('contaminated');
  app.dialogs.confirm.push(false, false); app.dialogs.prompt.push('leftover');
  app.window.eval('toast("leftover toast")');
  w.setInterval(() => { leak.timer++; }, 5);                        // live timer
  w.addEventListener('storage', () => { leak.storage++; });         // listeners
  w.document.addEventListener('click', () => { leak.click++; });
  for (let i = 0; i < 5; i++) d.rng.next();                          // driver stream advanced
  expect(app.eval('getBonusSplitMode()')).toBe('60-30-10');
  expect(app.state.scoreMatchId).toBeTruthy();
}

describe('isolation between tests (useApp fixture)', () => {
  it('A: contaminates the app, driver, ids, timers and listeners', async () => {
    contaminate(ctx.app, ctx.d);
    await new Promise((r) => setTimeout(r, 20));
    expect(leak.timer, 'the contaminating timer really ran').toBeGreaterThan(0);
  });

  it('B: the next test starts pristine (same file, same fixture)', async () => {
    await expectPristine(ctx.app, ctx.d);
  });
});

describe('sensitivity control', () => {
  it('the pristine check DOES fail on a contaminated window (so B passing is meaningful)', async () => {
    const app = await loadApp({ seed: SEED });
    try {
      const { createDriver } = await import('../factories/driver.js');
      contaminate(app, createDriver(app, { seed: SEED }));
      const fp = fingerprint(app);
      // Each item the review found leaking through the old reset is detected:
      expect(fp.bonusSplit).not.toBe(reference.bonusSplit);
      expect(fp.state.scoreMatchId).not.toEqual(reference.state.scoreMatchId);
      expect(fp.state.currentTab).not.toBe(reference.state.currentTab);
      expect(fp.downloadJson).not.toBe(reference.downloadJson);
      expect(() => expect(fp).toEqual(reference)).toThrow();
    } finally { app.close(); }
  });
});

describe('isolation between generated property cases', () => {
  it('every case starts pristine although each case contaminates', async () => {
    let cases = 0;
    const contaminating = defineProperty({
      id: 'selftest-isolation', title: 'isolation', defaultRuns: 5, caseBudgetMs: 10_000,
      arbitrary: fc.record({ seed: fc.constant(SEED) }),
      async run({ app, d }) {
        cases++;
        await expectPristine(app, d, { alsoOpen: [ctx.app] }); // ctx.app: this test's own fixture window
        contaminate(app, d);
      },
    });
    await checkProperty(contaminating);
    expect(cases).toBe(5);
  });
});

describe('the isolation guard (child process)', () => {
  let run;
  beforeAll(async () => {
    run = await runVitest({ config: 'test/selftest/probes/vitest.probes.config.js', files: ['test/selftest/probes/isolation.probe.js'] });
  }, 120_000);
  it('a test that leaves a window open fails with an ISOLATION error', () => {
    const t = run.tests.get('FAIL leaks an open window');
    expect(t.status).toBe('failed');
    expect(t.message).toContain('ISOLATION: 1 jsdom window(s) were left open');
  });
  it('a test that closes its window passes', () => {
    expect(run.tests.get('PASS closes its window').status).toBe('passed');
  });
});

afterAll(() => {
  // The contaminating timer belonged to a closed window; it must not have fired since.
  const frozen = leak.timer;
  return new Promise((r) => setTimeout(r, 30)).then(() => expect(leak.timer).toBe(frozen));
});
