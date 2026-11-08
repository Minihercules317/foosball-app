/**
 * Shared fast-check settings.
 *
 * Routine runs (npm test, CI) are DETERMINISTIC: a fixed seed, so the same
 * scenarios run every time and a red build always means a real change.
 *
 *   FC_RANDOM=1              → fresh random seed per run (exploration; used by npm run test:deep
 *                              and the scheduled "stress" workflow, never by routine CI)
 *   PROP_RUNS=200            → more scenarios per property
 *   FC_SEED=123 FC_PATH=...  → replay a reported failure exactly
 *   SHRINK=1                 → shrink to a minimal counterexample (slow: each run is a club night)
 */
export const DEFAULT_SEED = 20261108;

export function fcParams(defaultRuns = 15) {
  const p = {
    numRuns: Number(process.env.PROP_RUNS || defaultRuns),
    endOnFailure: process.env.SHRINK !== '1',
    verbose: 1,
  };
  if (process.env.FC_SEED) p.seed = Number(process.env.FC_SEED);
  else if (process.env.FC_RANDOM !== '1') p.seed = DEFAULT_SEED;
  if (process.env.FC_PATH) p.path = process.env.FC_PATH;
  return p;
}
