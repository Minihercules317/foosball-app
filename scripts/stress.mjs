// Randomized exploration with verified run counts. Used by .github/workflows/stress.yml
// (weekly / manual, and as a bounded call from CI) and locally:
//   node scripts/stress.mjs [--runs 150] [--seed N]
// --runs   cases per property (PROP_RUNS), applied to EVERY property incl. DISC-15 exploration
// --seed   fixed fast-check seed (deterministic); omit for a fresh random seed per property
// Exit code is non-zero if any property fails unexpectedly, is interrupted by its time
// budget, does not run, or does not execute the requested number of cases. A DISC-15
// instance (known discrepancy) is recorded and the exploration continues to the full
// case count; it is reported in the summary but does not fail. Stopping early does.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { verifyStress, summaryMarkdown, STRESS_FILES } from './stress-lib.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const runs = Number(arg('runs', process.env.STRESS_RUNS || '150'));
const seed = arg('seed', process.env.STRESS_SEED || '') || null;
if (!Number.isInteger(runs) || runs < 1) { console.error(`--runs must be a positive integer, got ${arg('runs')}`); process.exit(2); }
if (seed != null && !/^\d+$/.test(seed)) { console.error(`--seed must be an integer, got ${seed}`); process.exit(2); }

const RESULTS = process.env.LCFC_RESULTS_DIR || 'test-results'; // same root as test/harness/scenario.js
const RECORDS = path.join(RESULTS, 'property-runs');
rmSync(RECORDS, { recursive: true, force: true });
rmSync(path.join(RESULTS, 'scenarios'), { recursive: true, force: true });

const env = { ...process.env, PROP_RUNS: String(runs), EXPLORE: '1' };
delete env.STRICT; delete env.FC_PATH; delete env.SHRINK;
if (seed) { env.FC_SEED = seed; delete env.FC_RANDOM; } else { env.FC_RANDOM = '1'; delete env.FC_SEED; }
console.log(`stress: ${runs} case(s) per property, seed ${seed ?? 'random (printed per property before it runs)'}`);

const vitest = path.join('node_modules', 'vitest', 'vitest.mjs');
const r = spawnSync(process.execPath, [vitest, 'run', ...STRESS_FILES], { stdio: 'inherit', env });

const records = {};
if (existsSync(RECORDS)) {
  for (const f of readdirSync(RECORDS)) {
    const rec = JSON.parse(readFileSync(path.join(RECORDS, f), 'utf8'));
    records[rec.property] = rec;
  }
}
const result = verifyStress({ vitestExit: r.status ?? 1, records, requested: runs });
const md = summaryMarkdown({ requested: runs, seed, result });
console.log('\n' + md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
for (const p of result.problems) console.error(`::error title=stress::${p}`);
process.exit(result.ok ? 0 : 1);
