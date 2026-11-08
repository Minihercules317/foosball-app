/**
 * Scenario runner: makes every randomized case INDEPENDENTLY REPLAYABLE.
 *
 * A scenario is a plain JSON object (always with a numeric `seed`). Running it:
 *   1. restarts the fabricated-player id counter (p_0001, …);
 *   2. boots a FRESH window whose Math.random is mulberry32(scenario.seed);
 *   3. creates a FRESH driver whose own random stream is makeRng(scenario.seed);
 *   4. runs the body, then fails on any unexpected page error;
 *   5. closes the window (timers, listeners, storage gone).
 * Nothing survives from one case to the next, so the outcome depends only on the
 * scenario JSON — not on which cases ran before it (review F2). The two streams
 * share a seed by design: this matches how the pinned DISC-15 seeds were found, so
 * those reproductions stay valid. They are separate generator instances.
 *
 * Properties are declared once with defineProperty() in a non-test module (so
 * the replay entry point can import them) and registered with propertyTest().
 * On failure the runner writes test-results/scenarios/<id>__<seed>__<path>.json
 * containing the scenario, fast-check seed/path and replay commands, and puts the
 * same information in the error message. Before each case it records the case in
 * <id>.inflight.json so a run killed mid-case still names the scenario.
 */
import { it } from 'vitest';
import { getCurrentTest } from 'vitest/suite';
import fc from 'fast-check';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApp } from './loadApp.js';
import { createDriver } from '../factories/driver.js';
import { resetIds } from '../factories/players.js';
import { fcParams } from './fcConfig.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Output root (LCFC_RESULTS_DIR overrides, so nested self-test runs never touch the main results). */
const RESULTS_DIR = process.env.LCFC_RESULTS_DIR ? path.resolve(ROOT, process.env.LCFC_RESULTS_DIR) : path.join(ROOT, 'test-results');
export const SCENARIO_DIR = path.join(RESULTS_DIR, 'scenarios');
/** One JSON record per property run (seed, requested vs executed cases, timing) — read by scripts/stress.mjs. */
export const RUN_RECORD_DIR = path.join(RESULTS_DIR, 'property-runs');

const PAGE_ERRORS = Symbol.for('lcfc.pageErrors');
const PROPERTY_FAILURE = Symbol.for('lcfc.propertyFailure');

/** Page errors (uncaught exceptions / console.error) not matching an allow-list. */
export function unexpectedPageErrors(app, allow = []) {
  return app.errors.map(String).filter((msg) => !allow.some((re) => re.test(msg)));
}

export function makePageErrorsError(messages, cause) {
  const e = new Error(`UNEXPECTED PAGE ERRORS (${messages.length}):\n  ${messages.join('\n  ')}`, cause ? { cause } : undefined);
  e.name = 'PageErrors';
  e[PAGE_ERRORS] = messages;
  return e;
}
export const isPageErrorsError = (e) => !!(e && e[PAGE_ERRORS]);

/**
 * Run one scenario in complete isolation.
 * @param {object} scenario  plain JSON, must contain an integer `seed`
 * @param {(ctx:{app, d, scenario}) => any} body
 * @param {{appOptions?:object, allowPageErrors?:RegExp[]}} [opts]
 */
export async function runScenario(scenario, body, { appOptions = {}, allowPageErrors = [] } = {}) {
  if (!scenario || !Number.isInteger(scenario.seed)) throw new Error(`runScenario: scenario.seed must be an integer: ${JSON.stringify(scenario)}`);
  resetIds();
  const app = await loadApp({ seed: scenario.seed, ...appOptions });
  try {
    const d = createDriver(app, { seed: scenario.seed });
    let result;
    try {
      result = await body({ app, d, scenario });
    } catch (e) {
      const unexpected = unexpectedPageErrors(app, allowPageErrors);
      if (unexpected.length) throw makePageErrorsError(unexpected, e);
      throw e;
    }
    const unexpected = unexpectedPageErrors(app, allowPageErrors);
    if (unexpected.length) throw makePageErrorsError(unexpected);
    return result;
  } finally {
    app.close();
  }
}

/**
 * @typedef {object} PropertyDef
 * @property {string} id              stable id used in fixture files and replay
 * @property {string} title
 * @property {fc.Arbitrary<object>} arbitrary  generates scenarios (each with `seed`)
 * @property {number} defaultRuns
 * @property {number} caseBudgetMs     measured worst-case time per case, with headroom
 * @property {(ctx:{app, d, scenario, disc}) => any} run
 * @property {object} [appOptions]
 * @property {RegExp[]} [allowPageErrors]
 */
export function defineProperty(def) {
  for (const k of ['id', 'title', 'arbitrary', 'defaultRuns', 'caseBudgetMs', 'run']) {
    if (def[k] == null) throw new Error(`defineProperty: missing ${k}`);
  }
  return Object.freeze({ ...def });
}

/** Total time budget for a property run (all cases), from the per-case budget. */
export function propertyBudgetMs(def, numRuns = fcParams(def.defaultRuns).numRuns) {
  const perCase = Number(process.env.PROP_CASE_BUDGET_MS || def.caseBudgetMs);
  return numRuns * perCase;
}
/** Vitest timeout for a property test: the fast-check budget plus a margin to report. */
export const propertyTimeoutMs = (def) => propertyBudgetMs(def) + 60_000;

export const isPropertyFailure = (e) => !!(e && e[PROPERTY_FAILURE]);

/** The default `disc` given to property bodies outside a discrepancy: observing just asserts. */
export const PLAIN_OBSERVER = Object.freeze({ observe: (_name, fn) => fn() });

function safeName(s) { return String(s).replace(/[^A-Za-z0-9._-]+/g, '_'); }

function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

/** Shell-ready `-t` filter matching exactly this test name (vitest treats -t as a regex). */
function testNameFilter(name) {
  const re = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ` -t '${re.replace(/'/g, "'\\''")}'`;
}

/** The fast-check replay command for one case (EXPLORE=1 for exploratory tests, which are skipped otherwise). */
function fastCheckReplay(fcSeed, fcPath, testFile, testName) {
  const fileArg = testFile ? path.relative(ROOT, testFile) : '<test file>';
  const explore = process.env.EXPLORE === '1' ? 'EXPLORE=1 ' : '';
  return `${explore}FC_SEED=${fcSeed} FC_PATH=${fcPath} npx vitest run ${fileArg}${testName ? testNameFilter(testName) : ''}`;
}

/**
 * Run a property through fast-check with per-case isolation, seed reporting,
 * a time budget, and failure fixtures.
 *
 * Exploration (`disc.acceptKnown`, set by exploratory() in discrepancy.js): a case
 * whose ONLY failure is the known observation is recorded (fixture + disc.known) and
 * the run CONTINUES, so the requested number of cases still executes. Any other
 * failure stops the run and fails as usual.
 * @param {PropertyDef} def
 * @param {{disc?:object, signal?:AbortSignal, testFile?:string, testName?:string}} [opts]
 * @returns {Promise<{numRuns:number, seed:number, knownFindings:object[]}>}
 */
export async function checkProperty(def, { disc = PLAIN_OBSERVER, signal, testFile, testName } = {}) {
  const current = getCurrentTest();
  testFile = testFile || current?.file?.filepath;
  testName = testName || current?.name;
  const params = fcParams(def.defaultRuns);
  const budgetMs = propertyBudgetMs(def, params.numRuns);
  const inflightFile = path.join(SCENARIO_DIR, `${safeName(def.id)}.inflight.json`);
  const header = `[property ${def.id}] fast-check seed=${params.seed}${params.randomSeed ? ' (random)' : ''} runs=${params.numRuns}` +
    `${params.path ? ` path=${params.path}` : ''} budget=${Math.round(budgetMs / 1000)}s`;
  console.log(header); // printed BEFORE any case runs, so even a killed run names its seed

  let executed = 0;
  let slowest = { ms: 0, scenario: null };
  const known = []; // accepted known observations (exploration only)
  const started = Date.now();
  // fast-check path of the current case (no shrinking happens before it: earlier cases passed)
  const casePath = () => (params.path?.includes(':') ? params.path : String(Number(params.path || 0) + executed - 1));
  const recordKnown = (scenario, e) => {
    const fcPath = casePath();
    const fixture = path.join(SCENARIO_DIR, `${safeName(def.id)}__${params.seed}__${safeName(fcPath)}.json`);
    const report = {
      property: def.id, title: def.title, discrepancy: disc.id, checkpoint: disc.checkpoint,
      outcome: 'known discrepancy (recorded; exploration continued)',
      fcSeed: params.seed, fcPath, numRunsRequested: params.numRuns, caseNumber: executed, scenario,
      error: String(e.stack || e),
      replay: { scenarioOnly: `npm run replay -- ${path.relative(ROOT, fixture)}`, fastCheck: fastCheckReplay(params.seed, fcPath, testFile, testName) },
      recordedAt: new Date().toISOString(),
    };
    writeJson(fixture, report);
    const finding = { caseNumber: executed, fcPath, fixture: path.relative(ROOT, fixture), fixtureFile: fixture, report };
    known.push(finding);
    disc.known?.push(finding);
    console.warn(`[property ${def.id}] known discrepancy on case ${executed} of ${params.numRuns} — recorded (${finding.fixture}); continuing`);
  };
  const prop = fc.asyncProperty(def.arbitrary, async (scenario) => {
    if (signal?.aborted) throw new Error(`[property ${def.id}] aborted by the test runner (timeout?) before case ${executed + 1}`);
    executed++;
    writeJson(inflightFile, { property: def.id, fcSeed: params.seed, caseNumber: executed, startedAt: new Date().toISOString(), scenario });
    const t0 = Date.now();
    try {
      await runScenario(scenario, (ctx) => def.run({ ...ctx, disc }), { appOptions: def.appOptions, allowPageErrors: def.allowPageErrors });
    } catch (e) {
      if (!disc.acceptKnown?.(e)) throw e;
      recordKnown(scenario, e);
    } finally {
      const ms = Date.now() - t0;
      if (ms > slowest.ms) slowest = { ms, scenario };
    }
  });
  const record = (outcome, extra = {}) => writeJson(path.join(RUN_RECORD_DIR, `${safeName(def.id)}.json`), {
    property: def.id, outcome, fcSeed: params.seed, randomSeed: params.randomSeed, requested: params.numRuns,
    executed, durationMs: Date.now() - started, slowestCaseMs: slowest.ms, slowestCase: slowest.scenario,
    caseBudgetMs: Math.round(budgetMs / params.numRuns),
    ...(known.length ? { knownFindings: known.map(({ caseNumber, fcPath, fixture }) => ({ caseNumber, fcPath, fixture })) } : {}),
    ...extra,
  });

  const fcOpts = {
    numRuns: params.numRuns, seed: params.seed, endOnFailure: params.endOnFailure,
    interruptAfterTimeLimit: budgetMs, markInterruptAsFailure: true,
  };
  if (params.path) fcOpts.path = params.path;
  const out = await fc.check(prop, fcOpts);
  if (!out.failed) {
    rmSync(inflightFile, { force: true });
    record('passed');
    console.log(`[property ${def.id}] passed: ${executed} case(s) executed (requested ${params.numRuns})` +
      `${known.length ? `, ${known.length} with the known discrepancy` : ''}; slowest case ${slowest.ms} ms`);
    return { numRuns: executed, seed: params.seed, knownFindings: known };
  }

  // ---- failure: record everything needed to replay this exact case ----
  const scenario = out.counterexample ? out.counterexample[0] : null;
  const fcPath = out.counterexamplePath;
  const fixture = path.join(SCENARIO_DIR, `${safeName(def.id)}__${out.seed}__${safeName(fcPath || 'interrupted')}.json`);
  const rel = path.relative(ROOT, fixture);
  const report = {
    property: def.id,
    title: def.title,
    outcome: out.interrupted ? 'interrupted (time budget exhausted — NOT a counterexample)' : 'counterexample',
    fcSeed: out.seed,
    fcPath,
    numRunsRequested: params.numRuns,
    casesExecuted: executed,
    budgetMs,
    scenario,
    error: out.errorInstance ? String(out.errorInstance.stack || out.errorInstance) : null,
    replay: {
      scenarioOnly: scenario ? `npm run replay -- ${rel}` : null,
      fastCheck: fcPath ? fastCheckReplay(out.seed, fcPath, testFile, testName) : null,
    },
    recordedAt: new Date().toISOString(),
  };
  writeJson(fixture, report);
  if (!out.interrupted) rmSync(inflightFile, { force: true });
  record(out.interrupted ? 'interrupted' : 'counterexample', { fixture: path.relative(ROOT, fixture), fcPath });

  const msg = [
    `[property ${def.id}] ${out.interrupted
      ? `INTERRUPTED after ${executed} case(s): time budget ${Math.round(budgetMs / 1000)}s exhausted (raise PROP_CASE_BUDGET_MS or lower PROP_RUNS). In-flight case: ${path.relative(ROOT, inflightFile)}`
      : `FAILED on case ${executed} of ${params.numRuns}`}`,
    `  fast-check seed=${out.seed} path=${fcPath ?? '-'}`,
    `  fixture:  ${rel}`,
    report.replay.scenarioOnly ? `  replay this scenario alone:  ${report.replay.scenarioOnly}` : null,
    report.replay.fastCheck ? `  replay via fast-check:       ${report.replay.fastCheck}` : null,
    scenario ? `  scenario: ${JSON.stringify(scenario)}` : null,
    out.errorInstance ? `  cause: ${String(out.errorInstance.message || out.errorInstance).split('\n').slice(0, 8).join('\n    ')}` : null,
  ].filter(Boolean).join('\n');
  const err = new Error(msg, { cause: out.errorInstance || undefined });
  err.name = 'PropertyFailure';
  err[PROPERTY_FAILURE] = true;
  err.report = report;
  err.fixtureFile = fixture;
  throw err;
}

/** Register a property as a Vitest test with a timeout derived from its budget. */
export function propertyTest(def, { title = def.title, testFile } = {}) {
  return it(title, async ({ signal, task }) => {
    await checkProperty(def, { signal, testFile: testFile || task.file?.filepath, testName: title });
  }, propertyTimeoutMs(def));
}
