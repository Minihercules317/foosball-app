/**
 * Shared fast-check settings.
 *   PROP_RUNS=200 npm test   → deeper exploration (default keeps CI fast)
 *   SHRINK=1                 → enable shrinking to a minimal counterexample (slow:
 *                              each run replays a whole club night with full rendering)
 *   FC_SEED=123 FC_PATH=...  → replay a reported failure exactly
 */
export function fcParams(defaultRuns = 15) {
  const p = {
    numRuns: Number(process.env.PROP_RUNS || defaultRuns),
    endOnFailure: process.env.SHRINK !== '1',
    verbose: 1,
  };
  if (process.env.FC_SEED) p.seed = Number(process.env.FC_SEED);
  if (process.env.FC_PATH) p.path = process.env.FC_PATH;
  return p;
}
