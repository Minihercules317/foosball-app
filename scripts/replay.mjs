// Replay one saved scenario fixture alone, in a fresh process.
// Usage: npm run replay -- <fixture.json>   (see test/replay/replay.test.js)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error(`usage: npm run replay -- <scenario fixture .json>${file ? `\nnot found: ${file}` : ''}`);
  process.exit(2);
}
const env = { ...process.env, SCENARIO_FILE: path.resolve(file) };
const vitest = path.join('node_modules', 'vitest', 'vitest.mjs');
const r = spawnSync(process.execPath, [vitest, 'run', 'test/replay/replay.test.js'], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
