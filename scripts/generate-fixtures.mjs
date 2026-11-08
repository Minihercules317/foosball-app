// Regenerates test/fixtures/synthetic-club.json: a fully FABRICATED club backup
// produced by running the real app logic (jsdom harness) over several seeded nights.
// Usage: node scripts/generate-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { loadApp } from '../test/harness/loadApp.js';
import { createDriver } from '../test/factories/driver.js';

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
