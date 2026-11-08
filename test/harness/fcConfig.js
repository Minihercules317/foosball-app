/**
 * Shared fast-check settings.
 *
 * Routine runs (npm test, CI) are DETERMINISTIC: a fixed seed, so the same
 * scenarios run every time and a red build always means a real change.
 *
 *   FC_RANDOM=1              → fresh random seed per run (exploration; npm run test:deep
 *                              and the stress workflow, never routine CI). The seed is
 *                              chosen here and PRINTED BEFORE the run starts.
 *   PROP_RUNS=200            → scenarios per property (overrides each property's default)
 *   FC_SEED=123 FC_PATH=...  → replay a reported failure through fast-check
 *   SHRINK=1                 → shrink to a minimal counterexample (slow: each case is a club night)
 *   PROP_CASE_BUDGET_MS=...  → override the per-case time budget (see scenario.js)
 *
 * Every case runs in its own fresh window with its own seeded streams
 * (test/harness/scenario.js), so a case replays identically whether it runs
 * first, last or alone — FC_PATH replay and shrinking are therefore sound.
 */
export const DEFAULT_SEED = 20261108;

/**
 * @param {number} defaultRuns
 * @returns {{numRuns:number, seed:number, path?:string, endOnFailure:boolean, randomSeed:boolean}}
 */
export function fcParams(defaultRuns = 15) {
  const randomSeed = !process.env.FC_SEED && process.env.FC_RANDOM === '1';
  const seed = process.env.FC_SEED ? Number(process.env.FC_SEED)
    : randomSeed ? (Math.random() * 2 ** 31) | 0
      : DEFAULT_SEED;
  const p = {
    numRuns: Number(process.env.PROP_RUNS || defaultRuns),
    seed,
    endOnFailure: process.env.SHRINK !== '1',
    randomSeed,
  };
  if (!Number.isInteger(p.numRuns) || p.numRuns < 1) throw new Error(`PROP_RUNS must be a positive integer, got ${process.env.PROP_RUNS}`);
  if (process.env.FC_PATH) p.path = process.env.FC_PATH;
  return p;
}
