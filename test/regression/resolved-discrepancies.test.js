/**
 * [regression] Discrepancies RESOLVED in v7.34 (upstream 4b9127e, evaluated 2026-11-11).
 *
 * Each test is the former discrepancy check, with the SAME scenario and assertions: setup
 * assertions are now preconditions, and the checkpoint observation is an ordinary assertion.
 * Every one of them failed at its declared checkpoint against v7.28 and v7.32 (routine CI,
 * test/harness/discrepancy.js) and reported "DISCREPANCY NO LONGER REPRODUCES" against v7.34,
 * so each has been seen to fail on the defect and pass on the fix. They are not separately
 * mutation-probed. See docs/AUDIT.md section A2 for what changed in index.html and which
 * checks share one fix (ten checks, five underlying fixes).
 *
 * DISC-01 is only PARTIALLY resolved: the two scenarios below hold, but the random property
 * still finds double-booking after a correction — it stays a discrepancy in
 * test/discrepancies/bracket-corrections.test.js (with a v7.34 saved counterexample).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { useApp } from '../harness/useApp.js';
import { loadApp } from '../harness/loadApp.js';
import { runScenario, PLAIN_OBSERVER } from '../harness/scenario.js';
import { createDriver, runMonsterNight } from '../factories/driver.js';
import { sideIds } from '../factories/oracles.js';
import { assertNoDoubleBooking, singlesBracket, flipWinner, disc01Correction } from '../discrepancies/defs.js';

const ctx = useApp();
const key = (e) => sideIds(e).slice().sort().join('+');
function placements(t) { return t.placements || t.playoffs?.placements || {}; }
const firstRound = (t) => (t.playoffs.winnersRounds?.[0] || t.playoffs.rounds[0]).matches;

/** The DISC-01 counterexample that reproduced through v7.32 and holds since v7.34. */
const DISC01_RESOLVED = JSON.parse(readFileSync(new URL('../fixtures/scenarios/DISC-01-resolved-v734.json', import.meta.url), 'utf8'));

describe('DISC-01 (resolved instances) correcting a bracket result keeps the bracket structurally valid', () => {
  it(`[regression] [DISC-01] saved scenario ${JSON.stringify(DISC01_RESOLVED.scenario)}: no player is in two ready matches after the correction`, async () => {
    await runScenario(DISC01_RESOLVED.scenario, (c) => disc01Correction.run({ ...c, disc: PLAIN_OBSERVER }));
  });

  it('[regression] [DISC-01] single-elim 8: after flipping a quarter-final, its new loser is in no ready match', () => {
    const { d } = ctx;
    const t = singlesBracket(d, 8, 'single-elim');
    const qf1 = firstRound(t)[0];
    for (let i = 0; i < 6; i++) d.playBracketMatch(t, d.readyBracketMatches(t)[0], true); // QFs + SFs, side a wins
    const eliminated = key(qf1.a.entity);
    flipWinner(d, t, qf1); // now side b won QF1, so side a is out
    expect(qf1.winner, 'precondition: the correction was recorded').toBe('b');
    for (const m of d.readyBracketMatches(t)) {
      expect([key(m.a.entity), key(m.b.entity)], `eliminated ${eliminated} still scheduled`).not.toContain(eliminated);
    }
    assertNoDoubleBooking(d, t);
  });
});

describe('DISC-02 (resolved) placements stay consistent after a correction', () => {
  it('[regression] [DISC-02] single-elim 4: after re-scoring a semi-final, 1st/2nd/3rd are distinct (or cleared)', () => {
    const { d } = ctx;
    const t = singlesBracket(d, 4, 'single-elim');
    d.playBracketToCompletion(t, { pickWinner: () => true });
    expect(t.status, 'precondition: bracket finished').toBe('finished');
    const sf1 = firstRound(t)[0];
    const before = sf1.winner;
    flipWinner(d, t, sf1);
    expect(sf1.winner, 'precondition: the correction was recorded').not.toBe(before);
    const p = placements(t);
    const set = [p.first, p.second, p.third].filter(Boolean).map(key);
    expect(new Set(set).size, `placements ${JSON.stringify(set)}`).toBe(set.length);
  });
});

describe('DISC-03 (resolved) opening "edit score" and cancelling never changes a result', () => {
  it('[regression] [DISC-03] Monster playoff (Bo3): open edit modal on a finished match, cancel → winner unchanged', () => {
    const { d, app } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster', tables: 2 });
    d.addToEvent(t, ids);
    for (let i = 0; i < 2; i++) { d.generateRound(t); d.playRound(t); }
    d.startPlayoffs(t);
    const m = d.readyBracketMatches(t)[0];
    expect(m, 'precondition: a ready playoff match').toBeTruthy();
    d.playBracketMatch(t, m, true);
    expect(m.winner, 'precondition: the playoff match was won by side a').toBe('a');
    app.call('openPlayoffScore', m.id);
    app.call('closeScoreModal');
    expect(m.winner).toBe('a');
  });

  it('[regression] [DISC-03] Bo3 ranking round: open edit modal on a finished series, cancel → result unchanged', () => {
    const { d, app } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster', tables: 2, bestOf: 3 });
    d.addToEvent(t, ids);
    const r = d.generateRound(t);
    d.playRound(t);
    const m = r.matches[0];
    expect(m.status, 'precondition: the series was completed').toBe('done');
    const before = { status: m.status, scoreA: m.scoreA, scoreB: m.scoreB, games: m.games.length };
    d.open(t);
    app.call('openScoreModal', r.number, m.id);
    app.call('closeScoreModal');
    expect({ status: m.status, scoreA: m.scoreA, scoreB: m.scoreB, games: m.games.length }).toEqual(before);
  });

  it('[regression] [DISC-03] Bo3 bracket: re-entering a semi-final after the final never makes its new winner champion of a final they did not play', () => {
    const { d } = ctx;
    const ids = d.addPlayers(4);
    const t = d.createTournament({ type: 'singles', format: 'single-elim', bestOf: 3 });
    d.addToEvent(t, ids);
    d.startBracket(t);
    d.playBracketToCompletion(t, { pickWinner: () => true });
    const champion = key(placements(t).first);
    const sf = firstRound(t).find((m) => key(m.a.entity) === champion);
    expect(sf, 'precondition: the champion\'s semi-final').toBeTruthy();
    const challenger = key(sf.b.entity);
    d.playBracketMatch(t, sf, false); // edit: side b now wins the semi 2–0
    expect(sf.winner, 'precondition: the semi-final correction was recorded').toBe('b');
    expect(key(placements(t).first), `${challenger} is champion without playing the final`).not.toBe(challenger);
  });
});

describe('DISC-04 (resolved) a same-winner score correction only changes that match', () => {
  it('[regression] [DISC-04] fixing 5–1 → 5–2 in a semi keeps the final result', () => {
    const { d } = ctx;
    const t = singlesBracket(d, 4, 'single-elim');
    d.playBracketToCompletion(t, { pickWinner: () => true });
    const sf1 = firstRound(t)[0];
    const final = d.bracketMatches(t).find((m) => m.a?.fromMatch === sf1.id || m.b?.fromMatch === sf1.id);
    expect(final, 'precondition: the final fed by semi-final 1').toBeTruthy();
    const finalWinner = final.winner;
    expect(finalWinner, 'precondition: the final was played').toBeTruthy();
    const winnerBefore = sf1.winner;
    d.scoreBracket(t, sf1.id, sf1.winner === 'a' ? 5 : 1, sf1.winner === 'a' ? 1 : 5);
    expect(sf1.winner, 'precondition: same winner after the score fix').toBe(winnerBefore);
    expect(final.winner).toBe(finalWinner);
  });
});

describe('DISC-05 (resolved) club ranking follows corrected results', () => {
  it('[regression] [DISC-05] after a correction changes the champion, stored ranking deltas reflect the new podium', () => {
    const { d } = ctx;
    const t = singlesBracket(d, 4, 'single-elim');
    d.playBracketToCompletion(t, { pickWinner: () => true });
    expect(t.rankingApplied, 'precondition: ranking applied on finish').toBe(true);
    const oldChampion = key(placements(t).first);
    // Correct the final: other side wins
    const final = d.bracketMatches(t).find((m) => m.bracket !== 'bronze' && m !== t.playoffs.bronze
      && key(m.a?.entity) === key(placements(t).first) && m.winner === 'a' && (m.a?.fromMatch || m.b?.fromMatch));
    expect(final, 'precondition: the final').toBeTruthy();
    flipWinner(d, t, final);
    const champ = sideIds(placements(t).first)[0];
    expect(champ, 'precondition: the correction changed the champion').toBeTruthy();
    expect(champ, 'precondition: the correction changed the champion').not.toBe(oldChampion);
    expect(t.rankingDeltaDetail[champ]?.place, 'new champion still recorded with old place').toBe(1);
  });
});

describe('DISC-06 (resolved) import persistence', () => {
  const opened = [];
  async function boot(opts) { const app = await loadApp(opts); opened.push(app); return app; }
  afterEach(() => { while (opened.length) opened.pop().close(); });
  async function clubWithNight(seed) {
    const app = await boot({ seed });
    const d = createDriver(app, { seed });
    const { t, ids } = runMonsterNight(app, d, { players: 10 });
    return { app, d, t, ids };
  }

  it('[regression] [DISC-06] after a successful full replace-import, a reload shows the imported data', async () => {
    const { d: srcD } = await clubWithNight(5);
    const backup = srcD.exportAll().data;
    const app = await boot({ seed: 9 });
    const d = createDriver(app);
    d.addPlayers(3); // pre-existing local data
    const toasts = await d.importJson(backup, [false, true]); // Cancel = replace, OK = confirm
    expect(toasts.join(' '), 'precondition: import reported success').toMatch(/Data replaced/);
    expect(app.state.tournaments.length, 'precondition: imported event in memory').toBe(1);
    const reloaded = await boot({ data: app.stored() });
    expect(reloaded.state.tournaments.length, 'imported events lost on reload').toBe(1);
  });

  it('[regression] [DISC-06] after a single-event import, a reload still shows the event', async () => {
    const { d: srcD, t } = await clubWithNight(6);
    const payload = srcD.exportTournament(t).data;
    const app = await boot({ seed: 10 });
    const d = createDriver(app);
    d.addPlayers(2); // something already saved locally
    const toasts = await d.importJson(payload);
    expect(toasts.join(' '), 'precondition: import reported success').toMatch(/Imported event/);
    expect(app.state.tournaments.length, 'precondition: imported event in memory').toBe(1);
    const reloaded = await boot({ data: app.stored() });
    expect(reloaded.state.tournaments.length, 'imported event lost on reload').toBe(1);
  });
});
