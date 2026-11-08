import { it } from 'vitest';

/**
 * Discrepancy tests assert a PROPOSED invariant that the current production
 * behavior violates. They are kept at full strength — never weakened — and need
 * domain-owner review before anyone changes index.html.
 *
 * Default run (routine CI) — the test PASSES only if the body fails with an
 * assertion failure (the documented discrepancy still reproduces). It FAILS, with
 * a distinct message, if:
 *   - the body passes          → "DISCREPANCY NO LONGER REPRODUCES" (behavior changed:
 *                                 review, then convert to a normal contract test), or
 *   - the body throws anything other than an assertion failure (TypeError,
 *     timeout, harness crash) → "UNEXPECTED ERROR" (infrastructure/test bug).
 * This is stricter than Vitest's `it.fails`, which would hide crashes.
 *
 * STRICT=1 run (`npm run test:discrepancies`): registered as plain tests, so each
 * one fails and prints its reproduction.
 *
 * @param {string} id     ID from docs/AUDIT.md (e.g. 'DISC-03')
 * @param {string} title  the proposed invariant
 * @param {Function} fn   test body (asserts the invariant; may be async)
 */
export function discrepancy(id, title, fn, timeout) {
  const name = `[${id}] ${title}`;
  if (process.env.STRICT === '1') return it(name, fn, timeout);
  return it(name, async (...args) => {
    let error = null;
    try { await fn(...args); } catch (e) { error = e; }
    if (!error) {
      throw new Error(`[${id}] DISCREPANCY NO LONGER REPRODUCES — behavior changed. Review it, update docs/AUDIT.md, and convert this to a normal test.`);
    }
    if (!isAssertionFailure(error)) {
      const err = new Error(`[${id}] UNEXPECTED ERROR (not an assertion failure) — likely a test/harness problem: ${error && error.stack || error}`);
      err.cause = error;
      throw err;
    }
    // Expected: the documented discrepancy still reproduces.
  }, timeout);
}

/** Vitest/chai assertion errors, including ones wrapped by fast-check's fc.assert. */
export function isAssertionFailure(e) {
  for (let cur = e, depth = 0; cur && depth < 5; cur = cur.cause, depth++) {
    if (cur.name === 'AssertionError') return true;
    if (typeof cur.message === 'string' && /^Property failed/.test(cur.message) && /AssertionError/.test(cur.message)) return true;
  }
  return false;
}

/**
 * For a proposed invariant violated only RARELY under random exploration, where
 * no deterministic reproduction is known (so it cannot be a `discrepancy`).
 * Skipped everywhere except EXPLORE=1 runs (the scheduled/manual stress workflow),
 * with a bounded run count and timeout. A failure there is a lead to investigate,
 * not a confirmed bug, until it is captured as a deterministic `discrepancy`.
 */
export function exploratory(id, title, fn, timeout) {
  const name = `[${id}] (exploratory) ${title}`;
  return process.env.EXPLORE === '1' ? it(name, fn, timeout) : it.skip(name, fn, timeout);
}
