import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { openApps } from './loadApp.js';
import { isPropertyFailure, isPageErrorsError, unexpectedPageErrors, makePageErrorsError } from './scenario.js';

/**
 * Discrepancy tests assert a PROPOSED invariant that the current production
 * behavior violates. They are kept at full strength — never weakened — and need
 * domain-owner review before anyone changes index.html.
 *
 * Each discrepancy declares ONE named checkpoint: the final observation that
 * demonstrates it. The body does its setup normally and wraps only that final
 * observation in `disc.observe('<checkpoint>', () => { expect(...) })`.
 *
 *   discrepancy('DISC-03', 'cancel keeps the winner', { checkpoint: 'winner-after-cancel' }, (disc) => {
 *     ...setup: any failure here is a REAL failure...
 *     disc.observe('winner-after-cancel', () => expect(m.winner).toBe('a'));
 *   });
 *
 * Routine run — the test PASSES only if the body fails with an assertion failure
 * raised INSIDE observe() at the declared checkpoint (directly, or as the direct
 * cause of a property failure from test/harness/scenario.js), and no unexpected
 * page errors were recorded. Every other outcome FAILS with a distinct message:
 *   DISCREPANCY NO LONGER REPRODUCES  checkpoint reached and the invariant held
 *   CHECKPOINT NEVER REACHED          body finished without reaching the observation
 *   UNEXPECTED FAILURE                anything else: a setup/cleanup assertion, a
 *                                     TypeError (even one whose `cause` is an
 *                                     assertion), a harness crash, a non-assertion
 *                                     error inside observe(), a wrong checkpoint
 *   UNEXPECTED PAGE ERRORS            the app logged/threw errors not allowed for
 *                                     this discrepancy (`allowPageErrors`)
 *   (timeouts)                        Vitest fails the test; nothing is caught
 * Self-tests: test/selftest/classifier.test.js runs controlled probes for each case.
 *
 * STRICT=1 run (`npm run test:discrepancies`): registered as plain tests, so each
 * one fails and prints its reproduction (informational).
 *
 * @param {string} id     ID from docs/AUDIT.md (e.g. 'DISC-03')
 * @param {string} title  the proposed invariant
 * @param {{checkpoint:string, timeout?:number, allowPageErrors?:RegExp[]}} opts
 * @param {(disc:{observe:Function}) => any} fn  test body
 */
export function discrepancy(id, title, opts, fn) {
  const { checkpoint, timeout, allowPageErrors = [] } = validateOpts(id, opts, fn);
  const name = `[${id}] ${title}`;
  if (process.env.STRICT === '1') {
    return it(name, () => fn(makeObserver(id, checkpoint)), timeout);
  }
  return it(name, () => runDiscrepancy({ id, checkpoint, allowPageErrors }, fn), timeout);
}

/**
 * Proposed invariants that random search violates only RARELY. Skipped everywhere
 * except EXPLORE=1 runs (the stress workflow). Classification is the same as for
 * discrepancy(), except that finding the KNOWN violation is recorded, not failed:
 *   - no violation found                       → pass (the checkpoint must have been
 *                                                reached at least once, else FAIL)
 *   - violation at the declared checkpoint     → pass, but REPORTED: GitHub
 *       warning annotation + job summary line + scenario fixture file (artifact)
 *   - anything else (crash, unrelated assertion, page error, budget exhausted)
 *                                              → FAIL (red stress workflow)
 */
export function exploratory(id, title, opts, fn) {
  const { checkpoint, timeout, allowPageErrors = [] } = validateOpts(id, opts, fn);
  const name = `[${id}] (exploratory) ${title}`;
  if (process.env.EXPLORE !== '1') return it.skip(name, () => {}, timeout);
  return it(name, async () => {
    const outcome = await runDiscrepancy({ id, checkpoint, allowPageErrors, allowPass: true }, fn);
    if (outcome.reproduced) reportKnownFinding(id, checkpoint, outcome.error);
  }, timeout);
}

function validateOpts(id, opts, fn) {
  if (!opts || typeof opts !== 'object' || typeof opts.checkpoint !== 'string' || !opts.checkpoint) {
    throw new Error(`[${id}] discrepancy needs { checkpoint: '<name>' } naming its final observation`);
  }
  if (typeof fn !== 'function') throw new Error(`[${id}] discrepancy body must be a function`);
  return opts;
}

const OBSERVED = Symbol.for('lcfc.discrepancyObserved');

/** Vitest/chai assertion failure (exactly — no walking of `cause` chains). */
export function isAssertionError(e) {
  return !!e && typeof e === 'object' && e.name === 'AssertionError';
}

/**
 * The `disc` object handed to a discrepancy body. observe(name, fn):
 *   - name must be the declared checkpoint (else: harness bug, thrown as such);
 *   - fn passes          → returns normally (counted as "reached, held");
 *   - fn AssertionError  → throws a tagged observation (the expected outcome);
 *   - fn other error     → rethrown untouched (an UNEXPECTED failure).
 */
export function makeObserver(id, checkpoint) {
  const disc = {
    id, checkpoint, reached: 0,
    observe(name, fn) {
      if (name !== checkpoint) {
        throw new Error(`[${id}] observe('${name}') does not match the declared checkpoint '${checkpoint}' (test bug)`);
      }
      disc.reached++;
      let r;
      try { r = fn(); } catch (e) { throw wrapObservation(id, checkpoint, e); }
      if (r && typeof r.then === 'function') {
        return r.then(undefined, (e) => { throw wrapObservation(id, checkpoint, e); });
      }
      return r;
    },
  };
  return disc;
}

function wrapObservation(id, checkpoint, e) {
  if (!isAssertionError(e)) return e; // non-assertion inside observe(): unexpected, propagate as-is
  const obs = new Error(`[${id} @ ${checkpoint}] ${e.message}`, { cause: e });
  obs.name = 'DiscrepancyObserved';
  obs[OBSERVED] = { id, checkpoint };
  return obs;
}

/** The observation tag, if `e` is exactly a tagged observation. */
export const observationOf = (e) => (e && e[OBSERVED]) || null;

/**
 * Accept ONLY: a tagged observation for (id, checkpoint), or a property failure
 * from scenario.js whose DIRECT cause is such an observation. No deeper search,
 * no message matching.
 */
export function isExpectedObservation(e, id, checkpoint) {
  const direct = observationOf(e);
  if (direct) return direct.id === id && direct.checkpoint === checkpoint;
  if (isPropertyFailure(e) && !e.report?.outcome?.startsWith('interrupted')) {
    const inner = observationOf(e.cause);
    return !!inner && inner.id === id && inner.checkpoint === checkpoint;
  }
  return false;
}

/**
 * Core classifier (exported for self-tests). Resolves with
 * { reproduced: true, error } when the documented discrepancy reproduced, or
 * { reproduced: false } when allowPass and the invariant held; otherwise throws an
 * actionable error.
 */
export async function runDiscrepancy({ id, checkpoint, allowPageErrors = [], allowPass = false }, fn) {
  const disc = makeObserver(id, checkpoint);
  let error = null;
  try { await fn(disc); } catch (e) { error = e; }

  // Page errors in windows still open (fixture- or boot()-managed). Windows that
  // property cases opened are checked inside runScenario before they close.
  const pageErrors = openApps().flatMap((app) => unexpectedPageErrors(app, allowPageErrors));
  if (pageErrors.length) throw labelled(id, 'UNEXPECTED PAGE ERRORS — the app logged or threw errors during this discrepancy', makePageErrorsError(pageErrors, error || undefined));

  if (!error) {
    if (!disc.reached) {
      throw new Error(`[${id}] CHECKPOINT NEVER REACHED — the body finished without reaching observe('${checkpoint}'). The scenario no longer sets up the situation it documents; fix the test.`);
    }
    if (allowPass) return { reproduced: false }; // exploration: checkpoint reached, no violation found
    throw new Error(`[${id}] DISCREPANCY NO LONGER REPRODUCES — checkpoint '${checkpoint}' was reached and the proposed invariant held. Behavior changed: review it, update docs/AUDIT.md, and convert this to a normal test.`);
  }
  if (isExpectedObservation(error, id, checkpoint)) return { reproduced: true, error };

  const what = isPageErrorsError(error) ? 'page errors recorded in a scenario window'
    : isPropertyFailure(error) ? 'a property case failed somewhere other than the declared checkpoint'
      : observationOf(error) ? `observation from a different discrepancy/checkpoint (${JSON.stringify(observationOf(error))})`
        : isAssertionError(error) ? 'an assertion OUTSIDE the declared checkpoint (setup/execution/cleanup)'
          : `a ${error?.name || typeof error} was thrown`;
  throw labelled(id, `UNEXPECTED FAILURE (not the documented discrepancy at '${checkpoint}': ${what}) — fix the test or the harness; do not treat this as the known finding`, error);
}

function labelled(id, text, cause) {
  const detail = cause && (cause.stack || cause.message || String(cause));
  const err = new Error(`[${id}] ${text}${detail ? `\n${detail}` : ''}`, cause ? { cause } : undefined);
  return err;
}

function reportKnownFinding(id, checkpoint, error) {
  const fixture = error?.fixtureFile;
  const scenario = error?.report?.scenario ? JSON.stringify(error.report.scenario) : '(no scenario)';
  const line = `${id} reproduced at checkpoint '${checkpoint}' with a NEW random scenario: ${scenario}${fixture ? ` — fixture ${fixture}` : ''}`;
  console.warn(`KNOWN DISCREPANCY FOUND: ${line}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${id} reproduced by exploration::${line.replace(/\n/g, ' ')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ⚠️ ${line}\n`); } catch { /* best-effort; annotation + fixture remain */ }
  }
}
