// Regenerates test/fixtures/synthetic-club.json: a fully FABRICATED club backup
// produced by running the real app logic (jsdom harness) over several seeded nights.
// Usage: node scripts/generate-fixtures.mjs
//
// node scripts/generate-fixtures.mjs --historical <index.html of v7.28>
//   writes test/fixtures/historical/doubles-bracket-only-v7.28.json instead: the saved device
//   state of a FABRICATED bracket-only Doubles event played and scored by the OLD app
//   (git show 71c4a586:index.html > /some/tmp/index-v7.28.html). Used by the recalculation
//   regression check (test/regression/checks.js). The old page is only read into memory.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadApp } from '../test/harness/loadApp.js';
import { createDriver, runBracketOnlyTeamEvent } from '../test/factories/driver.js';

/**
 * Hand-set club points the committed v7.28 fixture was generated with (they were the
 * team-seed tests' starting balances until the v7.34 maintenance). Kept here ONLY so the
 * --historical fixture regenerates byte-for-byte; the tests themselves now derive starting
 * points from a recorded history (TEAM_EVENT_HISTORY in test/factories/driver.js), per the
 * owner-confirmed 2,000-point baseline. Offsets from 1800 are 5 × (2^k − 1).
 */
const V728_FIXTURE_START_POINTS = [1800, 1805, 1955, 2115, 2435, 1875, 1815, 1835];

const hist = process.argv.indexOf('--historical');
if (hist > 0) {
  const html = readFileSync(process.argv[hist + 1], 'utf8');
  const appVersion = html.match(/const APP_VERSION = '([^']+)'/)?.[1];
  if (appVersion !== '7.28') throw new Error(`--historical expects the v7.28 index.html, got v${appVersion}`);
  const app = await loadApp({ seed: 728, html });
  const d = createDriver(app, { seed: 728 });
  const { t } = runBracketOnlyTeamEvent(app, d, { type: 'doubles', format: 'double-elim', upset: true, name: 'Synthetic Doubles (v7.28 history)', legacyStartPoints: V728_FIXTURE_START_POINTS });
  t.createdAt = Date.UTC(2026, 9, 6, 23);
  app.call('saveState');
  const out = {
    provenance: {
      what: 'localStorage state of a fabricated bracket-only Doubles event, played and scored by the old app',
      appVersion,
      indexHtmlSha256: createHash('sha256').update(html).digest('hex'),
      scenario: 'runBracketOnlyTeamEvent({ type: "doubles", format: "double-elim", upset: true }), harness seed 728',
      generatedBy: 'node scripts/generate-fixtures.mjs --historical <v7.28 index.html>',
    },
    data: app.stored(),
  };
  mkdirSync('test/fixtures/historical', { recursive: true });
  writeFileSync('test/fixtures/historical/doubles-bracket-only-v7.28.json', JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote test/fixtures/historical/doubles-bracket-only-v7.28.json (v${appVersion}, ${out.data.players.length} players, ${out.data.tournaments.length} event)`);
  app.close();
  process.exit(0);
}

const app = await loadApp({ seed: 2026 });
const d = createDriver(app, { seed: 2026 });
const roster = d.addPlayers(14, { seed: 99 });
for (let n = 0; n < 3; n++) {
  const present = d.rng.shuffle(roster).slice(0, 8 + 2 * n);
  const t = d.createTournament({ type: 'monster', tables: 2, name: `Synthetic Night ${n + 1}` });
  t.createdAt = Date.UTC(2026, 0, 5 + 7 * n, 23);
  d.addToEvent(t, present);
  for (let r = 0; r < 3; r++) { d.generateRound(t); d.playRound(t); }
  d.startPlayoffs(t);
  d.playBracketToCompletion(t);
}
const { data } = d.exportAll();
data.exportedAt = '2026-01-20T04:00:00.000Z';
writeFileSync('test/fixtures/synthetic-club.json', JSON.stringify(data, null, 2) + '\n');
console.log(`wrote test/fixtures/synthetic-club.json (${data.players.length} players, ${data.tournaments.length} events)`);
app.close();
