/**
 * [regression] Discrepancies RESOLVED in v7.42 (upstream 2ad3b9f, evaluated 2026-11-12).
 *
 * Each test is the former discrepancy check with the SAME scenario and assertions: setup
 * assertions are now preconditions and the checkpoint observation is an ordinary assertion.
 * Every one failed at its declared checkpoint against v7.37 (routine CI, 3cff231) and reported
 * "DISCREPANCY NO LONGER REPRODUCES" against v7.42. Each was also confirmed against the resulting
 * app state, comparing v7.37 and v7.42 (docs/AUDIT.md section A3). Where a test asserts more than
 * the former check, the extra assertion is marked "(v7.42 addition)" and was likewise seen to
 * fail on v7.37 and pass on v7.42.
 *
 * NOT moved here, although they no longer reproduce:
 *   - DISC-09: v7.42 removes a deleted event's points immediately, which conflicts with owner
 *     rule 6 (AUDIT.md). It stays in test/discrepancies until the owner decides.
 *   - DISC-15 as a whole: only the two pinned counterexamples are resolved; random exploration
 *     keeps looking (test/discrepancies/partners.test.js, stress workflow).
 * DISC-10: only the documented MARKUP-injection scenario is covered. It does not show that ids are
 * safe in every context (see AUDIT.md A3 for a JavaScript-string vector that is still open).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadApp } from '../harness/loadApp.js';
import { runScenario } from '../harness/scenario.js';
import { createDriver, runMonsterNight } from '../factories/driver.js';
import { resetIds } from '../factories/players.js';
import { pk, priorPartnerPairs, minRematches, measureRematches } from '../factories/oracles.js';
import { replayNight } from '../factories/scenarios.js';

const opened = [];
async function boot(opts) { const app = await loadApp(opts); opened.push(app); return app; }
afterEach(() => { while (opened.length) opened.pop().close(); resetIds(); });
const pointsOf = (app) => Object.fromEntries(app.state.players.map((p) => [p.id, p.rankingPoints]));
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/scenarios/${name}`, import.meta.url), 'utf8'));

async function clubWithNight(seed) {
  const app = await boot({ seed });
  const d = createDriver(app, { seed });
  const { t, ids } = runMonsterNight(app, d, { players: 10 });
  return { app, d, t, ids };
}

describe('DISC-07 (resolved) importing an event that already exists', () => {
  it('[regression] [DISC-07] re-importing the same event (keep both) never changes anyone\'s ranking points', async () => {
    const { app, d, t } = await clubWithNight(7);
    const payload = d.exportTournament(t).data;
    const before = pointsOf(app);
    expect(Object.values(before).some((p) => p !== 2000), 'precondition: the night changed someone\'s points (else double counting is invisible)').toBe(true);
    await d.importJson(payload, [false]); // "already exists. Replace it?" → Cancel = import as copy
    expect(app.state.tournaments.length, 'precondition: the copy was imported').toBe(2);
    expect(pointsOf(app)).toEqual(before);
    // (v7.42 addition) The copy carried identical stored deltas; any rebuild from deltas
    // (reload) or full Recalculate would count them twice. Both failed on v7.37.
    const reloaded = await boot({ data: app.stored() });
    expect(pointsOf(reloaded), 'after a reload (totals rebuilt from stored deltas)').toEqual(before);
    app.call('recalculateClubRankingsFromEvents');
    expect(pointsOf(app), 'after "Recalculate ranking from events"').toEqual(before);
  });
});

describe('DISC-08 (resolved) robustness to malformed stored data', () => {
  for (const [label, tournaments] of [
    ['a null tournament entry', [null]],
    ['a tournament without playerIds', [{ id: 'tx', name: 'Broken', type: 'monster', rounds: [] }]],
    ['a numeric tournament name', [{ id: 'tx', name: 42, type: 'monster', playerIds: [], rounds: [] }]],
  ]) {
    it(`[regression] [DISC-08] app still finishes booting with ${label} (snapshot check + auto-refresh start)`, async () => {
      const app = await boot({ operator: false, data: { players: [], tournaments },
        snapshot: { type: 'full', players: [], tournaments: [] } });
      expect(app.eval('appRefreshTimer'), 'auto-refresh never started').toBeTruthy();
      expect(app.eval('clubSnapshotMeta.status'), 'snapshot never fetched').not.toBe('pending');
      // The former check had to ALLOW the boot-crash errors (they were the discrepancy).
      // Now none are allowed.
      expect(app.errors.map(String), 'page errors during boot').toEqual([]);
    });
  }
});

describe('DISC-10 (resolved: markup injection scenario) ids from imported data in HTML attributes', () => {
  it('[regression] [DISC-10] a crafted player id cannot inject markup into the Players list', async () => {
    const evilId = 'x"><img id="injected" src="data:,">';
    const player = { id: evilId, name: 'Crafted', skill: 3, rankingPoints: 2000, rankingDelta: 0, region: '', homeState: '' };
    // Delivered via localStorage here; in production the vector is an imported file or data/latest.json.
    const app = await boot({ data: { players: [player], tournaments: [] } });
    expect(app.state.players.map((p) => p.id), 'precondition: crafted player loaded (id kept as is)').toEqual([evilId]);
    const doc = app.window.document;
    expect(!!doc.getElementById('injected'), 'markup injected at boot').toBe(false);
    // (v7.42 addition) Positive control: the Players list really rendered the crafted
    // player, and the attribute carries the id as a plain value (escaped, not markup).
    app.call('showView', 'players');
    expect(doc.getElementById('view-players').textContent, 'the crafted player is listed').toContain('Crafted');
    const handlers = [...doc.querySelectorAll('#view-players [onclick]')].map((el) => el.getAttribute('onclick'));
    expect(handlers, 'the crafted id is an attribute value').toContain(`openPlayerProfile('${evilId}')`);
    expect(!!doc.getElementById('injected'), 'markup injected after rendering the Players list').toBe(false);
    expect(app.errors.map(String), 'page errors').toEqual([]);
  });
});

/**
 * DISC-15 (resolved for its two pinned counterexamples). Two layers:
 *  1. The ORIGINAL pinned scenarios, replayed whole. Since v7.42 changed sit-outs and pairing,
 *     these nights diverge from v7.37 from round 6 on, so they no longer rebuild the original
 *     round-10 situation. They are kept because they still meet a repeat-forced round 10
 *     (optimum >= 1, asserted) and must stay within the optimum in every round.
 *  2. The EXACT original round-10 situation: the v7.37 history after round 9 and the four players
 *     v7.37 seated (fixtures *-round10-history-v737.json). v7.37 chose two second-time pairs
 *     (2 repeats); 1 is possible. generateRound passes the non-sitting players to
 *     fairPairPlayers(), so it is called directly with those four players. Sit-out choice is out
 *     of scope here.
 * Neither layer shows that the draw is optimal in general, or anything about consecutive partners
 * or sit-outs.
 */
describe('DISC-15 (resolved: pinned counterexamples) partner draws use the fewest possible repeat partnerships', () => {
  for (const name of ['DISC-15-seed-4000099.json', 'DISC-15-seed-6000155.json']) {
    const fx = fixture(name);
    it(`[regression] [DISC-15] 7 players, 10 rounds (seed ${fx.scenario.seed}): never more repeat partnerships than the exact optimum`, async () => {
      // Same body as disc15Exploration.run (test/discrepancies/defs.js), plus the
      // discrimination precondition on round 10.
      await runScenario(fx.scenario, ({ app, d }) => {
        let t;
        const rows = measureRematches((s, cb) => (t = replayNight(app, d, s, cb)), fx.scenario);
        expect(t.rounds.flatMap((r) => r.matches).every((m) => m.status === 'done'), 'precondition: every round fully scored').toBe(true);
        expect(rows.map((r) => r.round), 'precondition: all 10 rounds were drawn').toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(rows[9].optimal, 'precondition: round 10 still forces at least one repeat (the documented kind of situation)').toBeGreaterThanOrEqual(1);
        for (const row of rows) {
          expect(row.actual, `round ${row.round}: ${row.actual} repeats, optimum ${row.optimal} (${row.players} players)`).toBeLessThanOrEqual(row.optimal);
        }
      });
    });
  }

  for (const name of ['DISC-15-seed-4000099-round10-history-v737.json', 'DISC-15-seed-6000155-round10-history-v737.json']) {
    const fx = fixture(name);
    it(`[regression] [DISC-15] exact v7.37 round-10 situation (${fx.source.split('/').pop()}): fairPairPlayers uses no more repeats than the optimum`, async () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const app = await boot({ seed, data: fx.data });
        const t = app.state.tournaments.find((x) => x.id === fx.tournamentId);
        expect(t?.rounds?.length, 'precondition: the saved v7.37 history (rounds 1-9) loaded').toBe(9);
        const prior = priorPartnerPairs(t.rounds);
        const repeats = (teams) => teams.filter(([a, b]) => prior.has(pk(a, b))).length;
        expect(minRematches(fx.round10.players, prior), 'precondition: one repeat is unavoidable, exactly as documented').toBe(1);
        expect(repeats(fx.round10.v737Teams), 'precondition: the recorded v7.37 choice had 2 repeats under this history').toBe(2);
        const json = app.eval(`JSON.stringify(fairPairPlayers(state.tournaments.find(x => x.id === ${JSON.stringify(fx.tournamentId)}),
          ${JSON.stringify(fx.round10.players)}.map(id => state.players.find(p => p.id === id))).map(([a, b]) => [a.id, b.id]))`);
        const teams = JSON.parse(json);
        expect(teams.flat().sort(), `seed ${seed}: every one of the four players is paired once`).toEqual(fx.round10.players.slice().sort());
        expect(repeats(teams), `seed ${seed}: ${JSON.stringify(teams)} repeats vs optimum 1`).toBeLessThanOrEqual(1);
        expect(app.errors.map(String), 'page errors').toEqual([]);
        app.close(); opened.splice(opened.indexOf(app), 1);
      }
    });
  }
});
