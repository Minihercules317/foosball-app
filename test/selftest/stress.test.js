/**
 * SELF-TEST (review F5/F6): the stress run cannot report success when it did not
 * do what was asked. Unit tests of the verification logic, plus one real stress
 * run in a child process with the app deliberately broken (must exit non-zero).
 * The workflow itself runs on every push via ci.yml → stress-smoke.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { verifyStress, STRESS_PROPERTIES } from '../../scripts/stress-lib.mjs';
import { checkProperty, defineProperty, RUN_RECORD_DIR } from '../harness/scenario.js';
import { runDiscrepancy } from '../harness/discrepancy.js';
import { ROOT } from './nested.js';

const V737_DRAW = 'reintroduce-disc15-v737-draw';

/** Run a command in a child process (no inherited Vitest/CI env); resolves {code, log}. */
function runChild(args, extraEnv) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|CI$|GITHUB_|TEST$|NODE_ENV$|LCFC_FAULT$|EXPLORE$|STRICT$|FC_|PROP_|SHRINK$)/.test(k)));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...env, NO_COLOR: '1', ...extraEnv } });
    let log = '';
    child.stdout.on('data', (b) => { log += b; });
    child.stderr.on('data', (b) => { log += b; });
    child.on('error', reject);
    child.on('close', (c) => resolve({ code: c, log }));
  });
}

const rec = (property, outcome, executed, requested = 5, extra = {}) => ({ property, outcome, executed, requested, fcSeed: 1, durationMs: 1, slowestCaseMs: 1, ...extra });
const allPassed = (n = 5) => Object.fromEntries(STRESS_PROPERTIES.map(({ id }) => [id, rec(id, 'passed', n, n)]));

describe('verifyStress', () => {
  it('passes only when every property ran the requested number of cases', () => {
    expect(verifyStress({ vitestExit: 0, records: allPassed(), requested: 5 }).ok).toBe(true);
  });
  it('fails when vitest failed, even if all records look fine', () => {
    const r = verifyStress({ vitestExit: 1, records: allPassed(), requested: 5 });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('vitest exited with code 1');
  });
  it('fails when a property did not run (e.g. the DISC-15 exploration was skipped)', () => {
    const records = allPassed(); delete records['DISC-15-exploration'];
    const r = verifyStress({ vitestExit: 0, records, requested: 5 });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('DISC-15-exploration: no run record');
  });
  it('fails when the requested run count did not reach a property (review F6: DISC-15 used its default 40)', () => {
    const records = allPassed(150); records['DISC-15-exploration'] = rec('DISC-15-exploration', 'passed', 40, 40);
    const r = verifyStress({ vitestExit: 0, records, requested: 150 });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('requested 40 cases but the stress run asked for 150');
  });
  it('fails when fewer cases executed than requested', () => {
    const records = allPassed(); records['bracket-clean'] = rec('bracket-clean', 'passed', 3);
    expect(verifyStress({ vitestExit: 0, records, requested: 5 }).ok).toBe(false);
  });
  it('fails on a time-budget interruption (review F5) and names it', () => {
    const records = allPassed(); records['bracket-clean'] = rec('bracket-clean', 'interrupted', 2, 5, { fixture: 'x.json' });
    const r = verifyStress({ vitestExit: 1, records, requested: 5 });
    expect(r.problems.join()).toContain('bracket-clean: interrupted after 2 of 5 case(s) — fixture x.json');
  });
  it('fails on a counterexample to a regular property', () => {
    const records = allPassed(); records['partners-repeat-free'] = rec('partners-repeat-free', 'counterexample', 2, 5, { fixture: 'p.json' });
    expect(verifyStress({ vitestExit: 1, records, requested: 5 }).ok).toBe(false);
  });
  it('reports — but does not fail on — a known DISC-15 instance when the full workload executed', () => {
    const records = allPassed();
    records['DISC-15-exploration'] = rec('DISC-15-exploration', 'passed', 5, 5, { knownFindings: [{ caseNumber: 1, fcPath: '0', fixture: 'd.json' }] });
    const r = verifyStress({ vitestExit: 0, records, requested: 5 });
    expect(r.ok, r.problems.join()).toBe(true);
    expect(r.findings.join()).toContain('DISC-15-exploration: known discrepancy reproduced on case 1 of 5 (exploration continued) — fixture d.json');
  });
  it('fails when a known DISC-15 counterexample stopped the run early (review F6: 1/3 and 2/5 reported success)', () => {
    for (const [executed, requested] of [[1, 3], [2, 5], [4, 5]]) {
      const records = allPassed(requested);
      records['DISC-15-exploration'] = rec('DISC-15-exploration', 'counterexample', executed, requested, { fixture: 'd.json' });
      const r = verifyStress({ vitestExit: 0, records, requested });
      expect(r.ok, `${executed}/${requested}`).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.problems.join()).toContain(`DISC-15-exploration: counterexample after ${executed} of ${requested} case(s) — fixture d.json — fast-check stopped early, so the requested workload did NOT complete`);
    }
  });
  it('fails when a run with known findings executed fewer cases than requested', () => {
    const records = allPassed();
    records['DISC-15-exploration'] = rec('DISC-15-exploration', 'passed', 1, 5, { knownFindings: [{ caseNumber: 1, fixture: 'd.json' }] });
    const r = verifyStress({ vitestExit: 0, records, requested: 5 });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('DISC-15-exploration: executed 1 of 5 requested cases');
  });
  it('fails when a regular property reports a known-discrepancy finding', () => {
    const records = allPassed(); records['bracket-clean'] = rec('bracket-clean', 'passed', 5, 5, { knownFindings: [{ caseNumber: 2, fixture: 'b.json' }] });
    expect(verifyStress({ vitestExit: 0, records, requested: 5 }).ok).toBe(false);
  });
  it('fails when a required property executed zero cases or was skipped', () => {
    for (const r0 of [rec('DISC-15-exploration', 'passed', 0), rec('DISC-15-exploration', 'skipped', 0)]) {
      const records = allPassed(); records['DISC-15-exploration'] = r0;
      expect(verifyStress({ vitestExit: 0, records, requested: 5 }).ok, r0.outcome).toBe(false);
    }
  });
});

describe('exploration continues past a known observation (checkProperty + exploratory classifier, real windows)', () => {
  const CP = 'final-observation';
  /** A property whose body behaves per case number: 'known' fails at the checkpoint, 'crash' throws a TypeError. */
  const scripted = (id, plan) => {
    let n = 0;
    return defineProperty({
      id, title: id, arbitrary: fc.record({ seed: fc.integer({ min: 1, max: 1000 }) }), defaultRuns: 4, caseBudgetMs: 20_000,
      run: ({ disc }) => {
        const what = plan[n++];
        if (what === 'crash') throw new TypeError('injected crash after a known observation');
        disc.observe(CP, () => expect(what === 'known' ? 2 : 1).toBe(1));
      },
    });
  };
  const readRecord = (id) => JSON.parse(readFileSync(path.join(RUN_RECORD_DIR, `${id}.json`), 'utf8'));
  const explore = (def) => runDiscrepancy({ id: 'PROBE', checkpoint: CP, allowPass: true, continueOnKnown: true }, (disc) => checkProperty(def, { disc }));

  it('known observation on case 1 of N: recorded, and all N cases still execute', async () => {
    const def = scripted('selftest-f6-known-first', ['known']);
    const outcome = await explore(def);
    const r = readRecord(def.id);
    expect(r.outcome).toBe('passed');
    expect(r.executed).toBe(r.requested);
    expect(r.requested).toBeGreaterThan(1);
    expect(r.knownFindings).toEqual([expect.objectContaining({ caseNumber: 1, fcPath: '0' })]);
    expect(outcome.reproduced).toBe(true);
    expect(outcome.findings).toHaveLength(1);
    const fx = JSON.parse(readFileSync(path.join(ROOT, r.knownFindings[0].fixture), 'utf8'));
    expect(fx).toMatchObject({ property: def.id, discrepancy: 'PROBE', checkpoint: CP, caseNumber: 1 });
    expect(fx.replay.fastCheck).toContain('npx vitest run test/selftest/stress.test.js -t ');
    expect(fx.replay.fastCheck).not.toContain('<test file>');
  });
  it('known observation then an unexpected error: the error is NOT hidden', async () => {
    const def = scripted('selftest-f6-known-then-crash', ['known', 'crash']);
    const err = await explore(def).then(() => null, (e) => e);
    expect(err?.message).toContain('[PROBE] UNEXPECTED FAILURE');
    expect(err?.message).toContain('injected crash after a known observation');
    const r = readRecord(def.id);
    expect(r).toMatchObject({ outcome: 'counterexample', executed: 2 });
    expect(r.knownFindings).toEqual([expect.objectContaining({ caseNumber: 1 })]);
    // …and the stress verifier fails it (counterexample = stopped early, and vitest would be red).
    const records = allPassed(r.requested); records['DISC-15-exploration'] = { ...r, property: 'DISC-15-exploration' };
    expect(verifyStress({ vitestExit: 0, records, requested: r.requested }).ok).toBe(false);
  });
  it('outside exploration (discrepancy()/plain), a known observation still stops the run as before', async () => {
    const def = scripted('selftest-f6-routine', ['known']);
    const outcome = await runDiscrepancy({ id: 'PROBE', checkpoint: CP }, (disc) => checkProperty(def, { disc }));
    expect(outcome.reproduced).toBe(true);
    expect(readRecord(def.id)).toMatchObject({ outcome: 'counterexample', executed: 1 });
  });
});

describe('real stress command: DISC-15 known counterexample on case 1 (review F6 reproduction, child process)', () => {
  // fast-check seed 1671: the FIRST DISC-15 case (scenario seed 13, 7 players, round 8: 2 repeats,
  // optimum 1) was a real DISC-15 instance against v7.28–v7.37. Before the F6 fix this printed
  // "1 / 3 … Result: passed". v7.42 no longer reproduces it, so the self-test re-injects the v7.37
  // draw (LCFC_FAULT=reintroduce-disc15-v737-draw in test/harness/faults.js, verbatim v7.37 code) — the same way
  // classifier.test.js re-injects the DISC-03 defect — instead of depending on a live app bug.
  // The control below runs the same command on the unmodified app.
  it('runs all 3 cases of every property, reports the finding, and the finding replays', async () => {
    const out = path.join('test-results', 'selftest', `stress-f6-${process.pid}`);
    rmSync(path.join(ROOT, out), { recursive: true, force: true });
    const { code, log } = await runChild(['scripts/stress.mjs', '--runs', '3', '--seed', '1671'], { LCFC_RESULTS_DIR: out, LCFC_FAULT: V737_DRAW });
    const records = readdirSync(path.join(ROOT, out, 'property-runs')).map((f) => JSON.parse(readFileSync(path.join(ROOT, out, 'property-runs', f), 'utf8')));
    const disc15 = records.find((r) => r.property === 'DISC-15-exploration');
    expect(log, 'precondition: seed 1671 must hit DISC-15 on case 1 (fast-check path 0)').toMatch(/KNOWN DISCREPANCY FOUND: DISC-15 .*DISC-15-exploration__1671__0\.json/);
    expect(code, log.slice(-3000)).toBe(0);
    expect(records.map((r) => r.property).sort()).toEqual(STRESS_PROPERTIES.map((p) => p.id).sort());
    // The workload really completed — not just a green summary line.
    for (const r of records) expect([r.property, r.outcome, r.executed, r.requested]).toEqual([r.property, 'passed', 3, 3]);
    expect(disc15.knownFindings).toEqual([expect.objectContaining({ caseNumber: 1, fcPath: '0' })]);
    expect(log).toContain('| DISC-15-exploration | passed (1 known finding(s)) | 1671 | 3 / 3 |');
    expect(log).toContain('DISC-15-exploration: known discrepancy reproduced on case 1 of 3 (exploration continued)');
    expect(log).toContain('**Result: passed**');
    const replay = await runChild(['scripts/replay.mjs', disc15.knownFindings[0].fixture], { LCFC_FAULT: V737_DRAW });
    expect(replay.code, replay.log.slice(-2000)).toBe(1);
    expect(replay.log).toContain('[DISC-15 @ repeats-within-optimum] round 8: 2 repeats, optimum 1');
    // Sensitivity: the finding is the injected v7.37 draw — the same fixture holds on v7.42.
    const clean = await runChild(['scripts/replay.mjs', disc15.knownFindings[0].fixture], {});
    expect(clean.code, clean.log.slice(-2000)).toBe(0);
    rmSync(path.join(ROOT, out), { recursive: true, force: true });
  }, 300_000);

  it('control: the same command on the unmodified app runs all 3 cases, finds nothing, and passes (exploration does not need the old defect)', async () => {
    const out = path.join('test-results', 'selftest', `stress-f6-clean-${process.pid}`);
    rmSync(path.join(ROOT, out), { recursive: true, force: true });
    const { code, log } = await runChild(['scripts/stress.mjs', '--runs', '3', '--seed', '1671'], { LCFC_RESULTS_DIR: out });
    const records = readdirSync(path.join(ROOT, out, 'property-runs')).map((f) => JSON.parse(readFileSync(path.join(ROOT, out, 'property-runs', f), 'utf8')));
    expect(code, log.slice(-3000)).toBe(0);
    expect(records.map((r) => r.property).sort()).toEqual(STRESS_PROPERTIES.map((p) => p.id).sort());
    for (const r of records) expect([r.property, r.outcome, r.executed, r.requested, r.knownFindings || []]).toEqual([r.property, 'passed', 3, 3, []]);
    expect(log).not.toContain('KNOWN DISCREPANCY FOUND');
    expect(log).toContain('| DISC-15-exploration | passed | 1671 | 3 / 3 |');
    expect(log).toContain('**Result: passed**');
    rmSync(path.join(ROOT, out), { recursive: true, force: true });
  }, 300_000);
});

describe('real stress run with the app broken (child process)', () => {
  it('exits non-zero, names the failures and writes a replayable fixture for each failing property', async () => {
    const out = path.join('test-results', 'selftest', `stress-${process.pid}`);
    rmSync(path.join(ROOT, out), { recursive: true, force: true });
    const { code, log } = await runChild(['scripts/stress.mjs', '--runs', '2', '--seed', '7'], { LCFC_FAULT: 'noop-submitScore', LCFC_RESULTS_DIR: out });
    expect(code, log.slice(-3000)).toBe(1);
    expect(log).toContain('**Result: FAILED**');
    expect(log).toMatch(/bracket-clean: counterexample after 1 of 2 case\(s\) — fixture/);
    // Every property that failed has a run record pointing at a replayable fixture.
    const records = readdirSync(path.join(ROOT, out, 'property-runs')).map((f) => JSON.parse(readFileSync(path.join(ROOT, out, 'property-runs', f), 'utf8')));
    const failed = records.filter((r) => r.outcome !== 'passed');
    expect(failed.map((r) => r.property)).toContain('bracket-clean'); // a bracket can never finish without scores
    for (const r of failed) {
      expect(r.requested, r.property).toBe(2);
      const fx = JSON.parse(readFileSync(path.join(ROOT, r.fixture), 'utf8'));
      expect(fx).toMatchObject({ property: r.property, fcSeed: 7 });
      expect(fx.scenario.seed, r.property).toEqual(expect.any(Number));
      expect(fx.replay.scenarioOnly).toContain('npm run replay -- ');
      expect(fx.replay.fastCheck).toContain('FC_SEED=7 FC_PATH=');
    }
    rmSync(path.join(ROOT, out), { recursive: true, force: true });
  }, 240_000);
});
