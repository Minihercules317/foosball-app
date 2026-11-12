/**
 * SELF-TEST (review F2): a reported failing scenario replays independently of
 * which cases ran before it, in which order, or in which process.
 *
 * The review's probe: a 3-case property reported seed/path for its third case,
 * whose score was 2; replaying that path alone gave 5, because the driver's
 * random stream and the id counter carried over between cases. Here every
 * observation is a full Monster-night trace (partners, sit-outs, tables, scores)
 * produced by the production code via test/selftest/replay-demo.js.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { checkProperty, runScenario, defineProperty } from '../harness/scenario.js';
import { createDriver } from '../factories/driver.js';
import { hooks, replayDemo, nightTrace } from './replay-demo.js';
import { ROOT } from './nested.js';

afterEach(() => { hooks.record = null; hooks.failWhen = null; });

/** Run the demo property and collect (scenario, trace) per executed case, in order. */
async function collect(def = replayDemo) {
  const cases = [];
  hooks.record = (scenario, trace) => cases.push({ scenario, trace });
  await checkProperty(def);
  hooks.record = null;
  return cases;
}

const traceOf = (scenario) => runScenario(scenario, ({ app, d }) => nightTrace(app, d, scenario));

function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, NO_COLOR: '1', ...env } });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe('independent replay of randomized scenarios', () => {
  it('the same scenario run three times in one property gives three identical traces (review probe)', async () => {
    const constant = defineProperty({ ...replayDemo, id: 'selftest-replay-constant', arbitrary: fc.constant({ seed: 42, players: 7, rounds: 3 }), defaultRuns: 3 });
    const cases = await collect(constant);
    expect(cases).toHaveLength(3);
    expect(cases[1].trace).toEqual(cases[0].trace);
    expect(cases[2].trace).toEqual(cases[0].trace);
  });

  it('sensitivity control: the trace DOES depend on the random streams (so equality above is meaningful)', async () => {
    const scenario = { seed: 42, players: 7, rounds: 3 };
    const clean = await traceOf(scenario);
    // Reproduce the OLD bug on purpose: a driver whose stream already advanced.
    const shared = await runScenario(scenario, ({ app }) => {
      const d = createDriver(app, { seed: scenario.seed });
      for (let i = 0; i < 7; i++) d.rng.next();
      return nightTrace(app, d, scenario);
    });
    expect(shared).not.toEqual(clean);
  });

  it('every case replays identically alone, in reverse order, and after contaminating scenarios', async () => {
    const cases = await collect();
    expect(cases.length).toBe(6);
    const reversed = [];
    for (const c of cases.slice().reverse()) {
      // Contaminate between replays: different settings, substituted functions, open modal.
      await runScenario({ seed: 999 }, ({ app, d }) => {
        app.window.localStorage.setItem('lcfc_bonus_split_v1', '60-30-10');
        app.eval('downloadJson = function () { throw new Error("contaminated"); }');
        nightTrace(app, d, { players: 9, rounds: 2 });
      });
      reversed.push({ scenario: c.scenario, trace: await traceOf(c.scenario) });
    }
    for (const c of cases) {
      expect(reversed.find((r) => r.scenario === c.scenario).trace, JSON.stringify(c.scenario)).toEqual(c.trace);
    }
  });

  it('a LATER case that fails is reported with seed, path and fixture, and replays alone — via FC_PATH, via the fixture, and in a separate process', async () => {
    const cases = await collect();
    const target = 3; // the 4th case: not the first one, so earlier cases ran before it
    const wanted = cases[target];

    // 1) the failing run: fails exactly on the 4th case
    hooks.failWhen = (trace) => JSON.stringify(trace) === JSON.stringify(wanted.trace);
    const failure = await checkProperty(replayDemo).then(() => null, (e) => e);
    expect(failure, 'the property failed').toBeTruthy();
    const { report } = failure;
    expect(report.casesExecuted).toBe(target + 1);
    expect(report.fcPath).toBe(String(target));
    expect(report.scenario).toEqual(wanted.scenario);
    expect(failure.message).toContain(`fast-check seed=${report.fcSeed} path=${target}`);
    expect(failure.message).toContain('npm run replay -- test-results/scenarios/');
    expect(existsSync(failure.fixtureFile)).toBe(true);
    const fixture = JSON.parse(readFileSync(failure.fixtureFile, 'utf8'));
    expect(fixture.scenario).toEqual(wanted.scenario);

    // 2) replay via fast-check seed + path: only that case runs, first, and fails the same way
    const viaPath = [];
    hooks.record = (scenario, trace) => viaPath.push({ scenario, trace });
    const replayed = await withEnv({ FC_SEED: String(report.fcSeed), FC_PATH: report.fcPath },
      () => checkProperty(replayDemo).then(() => null, (e) => e));
    expect(replayed, 'FC_PATH replay reproduces the failure').toBeTruthy();
    expect(replayed.report.casesExecuted).toBe(1);
    expect(viaPath).toEqual([wanted]);

    // 3) replay the saved scenario alone (no fast-check at all)
    expect(await traceOf(fixture.scenario)).toEqual(wanted.trace);

    // 4) replay in a NEW PROCESS via the documented command
    const child = await runNode(['scripts/replay.mjs', path.relative(ROOT, failure.fixtureFile)], { REPLAY_TRACE: '1' });
    const line = child.out.split('\n').find((l) => l.startsWith('TRACE '));
    expect(line, child.out.slice(-2000)).toBeTruthy();
    expect(JSON.parse(line.slice('TRACE '.length))).toEqual(wanted.trace);
    expect(child.code).toBe(0);
  }, 180_000);

  it('a committed discrepancy fixture reproduces its tagged observation alone in a new process (and only because of its claim)', async () => {
    // Synthetic fixture (test/selftest/fixtures/replay-discrepancy.json): a real Monster night
    // plus a deliberately wrong claim, so this does not depend on a live application bug
    // (until v7.34 it replayed the DISC-01 fixture, which v7.34 resolved).
    const FIXTURE = 'test/selftest/fixtures/replay-discrepancy.json';
    const child = await runNode(['scripts/replay.mjs', FIXTURE], {});
    expect(child.code, child.out.slice(-2000)).not.toBe(0);
    expect(child.out).toContain('[SELFTEST-REPLAY @ round1-sit-outs-match-claim] round 1 sit-outs (claimed 2): expected 3 to be 2');

    // Control: the same scenario with the correct claim replays cleanly in a new process, so the
    // failure above comes from the tagged observation, not from replay plumbing or the app.
    const fx = JSON.parse(readFileSync(path.join(ROOT, FIXTURE), 'utf8'));
    const dir = path.join(ROOT, 'test-results', 'selftest');
    mkdirSync(dir, { recursive: true });
    const control = path.join(dir, `replay-discrepancy-control-${process.pid}.json`);
    writeFileSync(control, JSON.stringify({ ...fx, scenario: { ...fx.scenario, claimedSitOuts: 3 } }));
    try {
      const ok = await runNode(['scripts/replay.mjs', path.relative(ROOT, control)], {});
      expect(ok.code, ok.out.slice(-2000)).toBe(0);
      expect(ok.out).toContain('[replay] selftest-replay-discrepancy');
    } finally { rmSync(control, { force: true }); }
  }, 120_000);
});
