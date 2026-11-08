import { it } from 'vitest';

/**
 * Discrepancy tests assert a PROPOSED invariant that the current production
 * behavior violates. They are kept at full strength — never weakened — and
 * need domain-owner review before anyone changes index.html.
 *
 * Default run (CI): registered with `it.fails`, so the suite stays green while
 * the discrepancy exists and turns RED the moment behavior changes (fixed or
 * otherwise), forcing a deliberate review.
 *
 * STRICT=1 run: registered as normal tests, so each one fails and prints its
 * reproduction. Use: `npm run test:discrepancies`.
 *
 * @param {string} id     ID from docs/AUDIT.md (e.g. 'DISC-03')
 * @param {string} title  the proposed invariant
 * @param {Function} fn   test body (asserts the invariant)
 */
export function discrepancy(id, title, fn, timeout) {
  const strict = process.env.STRICT === '1';
  const name = `[${id}] ${title}`;
  return strict ? it(name, fn, timeout) : it.fails(name, fn, timeout);
}

/**
 * Like `discrepancy`, for a proposed invariant that is violated only RARELY under
 * random exploration (so `it.fails` would be flaky). Skipped in normal runs; in
 * STRICT=1 runs it executes as a normal (possibly failing) property test.
 * Pair it with a deterministic `discrepancy` reproduction once a seed is known.
 */
export function exploratory(id, title, fn, timeout) {
  const strict = process.env.STRICT === '1';
  const name = `[${id}] (exploratory) ${title}`;
  return strict ? it(name, fn, timeout) : it.skip(name, fn, timeout);
}
