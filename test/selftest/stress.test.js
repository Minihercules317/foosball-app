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
import { verifyStress, STRESS_PROPERTIES } from '../../scripts/stress-lib.mjs';
import { ROOT } from './nested.js';

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
  it('reports — but does not fail on — a new instance of the known DISC-15 discrepancy', () => {
    const records = allPassed(); records['DISC-15-exploration'] = rec('DISC-15-exploration', 'counterexample', 2, 5, { fixture: 'd.json' });
    const r = verifyStress({ vitestExit: 0, records, requested: 5 });
    expect(r.ok).toBe(true);
    expect(r.findings.join()).toContain('known discrepancy reproduced');
  });
});

describe('real stress run with the app broken (child process)', () => {
  it('exits non-zero, names the failures and writes a replayable fixture for each failing property', async () => {
    const out = path.join('test-results', 'selftest', `stress-${process.pid}`);
    rmSync(path.join(ROOT, out), { recursive: true, force: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|CI$|GITHUB_|TEST$|NODE_ENV$)/.test(k)));
    const { code, log } = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/stress.mjs', '--runs', '2', '--seed', '7'], {
        cwd: ROOT, env: { ...env, NO_COLOR: '1', LCFC_FAULT: 'noop-submitScore', LCFC_RESULTS_DIR: out },
      });
      let log = '';
      child.stdout.on('data', (b) => { log += b; });
      child.stderr.on('data', (b) => { log += b; });
      child.on('error', reject);
      child.on('close', (c) => resolve({ code: c, log }));
    });
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
