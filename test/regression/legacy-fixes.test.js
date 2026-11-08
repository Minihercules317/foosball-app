/**
 * [regression] Guards for bugs that index.html's own comments say were fixed in
 * earlier releases. Each test cites the comment it protects.
 */
import { describe, it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { runMonsterNight } from '../factories/driver.js';
import { sideIds } from '../factories/oracles.js';

const ctx = useApp();

describe('legacy fixes stay fixed', () => {
  it('"Fix brackets saved with the old bug (TBD treated as bye)": bogus 0–0 wins against pending feeds are cleared', () => {
    const { app } = ctx;
    const b = app.toWindow({
      winnersRounds: [{ matches: [
        { id: 'm1', a: { entity: { id: 'e1', name: 'E1' } }, b: { entity: null, fromMatch: 'm0' }, winner: 'a', loser: 'b', scoreA: 0, scoreB: 0 },
        { id: 'm2', a: { entity: { id: 'e2', name: 'E2' } }, b: { entity: null }, winner: 'a', loser: 'b', scoreA: 0, scoreB: 0 },
      ] }],
    });
    app.call('sanitizeBracketMatches', b);
    expect(b.winnersRounds[0].matches[0].winner).toBeNull(); // pending feed: not a bye
    expect(b.winnersRounds[0].matches[1].winner).toBe('a'); // genuine bye: kept
  });

  it('"old code assigned 4, 5, 6… to individual players, splitting doubles partners": partners share a finish place', () => {
    const { app, d } = ctx;
    const { t } = runMonsterNight(app, d, { players: 12 });
    for (const team of t.playoffTeams) {
      const [a, b] = team.playerIds;
      expect(t.rankingDeltaDetail[a].place).toBe(t.rankingDeltaDetail[b].place);
    }
  });

  it('"Previous sort put more losses first": non-podium places go to deeper runs first', () => {
    const { app, d } = ctx;
    const { t } = runMonsterNight(app, d, { players: 16, rounds: 2 });
    const losses = {};
    for (const m of d.bracketMatches(t)) {
      if (!m.winner || (m.scoreA === 0 && m.scoreB === 0) || !m.a?.entity || !m.b?.entity) continue;
      for (const id of sideIds(m.winner === 'a' ? m.b.entity : m.a.entity)) losses[id] = (losses[id] || 0) + 1;
    }
    const rest = Object.entries(t.rankingDeltaDetail).filter(([, x]) => x.place >= 4)
      .map(([id, x]) => ({ place: x.place, losses: losses[id] || 0 })).sort((a, b) => a.place - b.place);
    for (let i = 1; i < rest.length; i++) expect(rest[i].losses).toBeGreaterThanOrEqual(rest[i - 1].losses);
  });

  it('"Wiping and full-recalc was overwriting stored event deltas": loading a backup keeps the file\'s per-event deltas', () => {
    const { app, d } = ctx;
    const { t } = runMonsterNight(app, d, { players: 8 });
    const backup = JSON.parse(JSON.stringify(d.exportAll().data));
    const pid = Object.keys(backup.tournaments[0].rankingDeltas)[0];
    backup.tournaments[0].rankingDeltas[pid] = 0; // historical value under older rules
    app.reset();
    app.call('applyFullBackupData', app.toWindow(backup), app.toWindow({ silent: true }));
    expect(app.state.tournaments[0].rankingDeltas[pid]).toBe(0);
    expect(app.state.players.find((p) => p.id === pid).rankingPoints).toBe(2000);
    expect(t).toBeTruthy();
  });

  it('"Upgrade previous default start (900) to 2000 if no ranking results applied yet"', () => {
    const { app } = ctx;
    const fresh = app.toWindow({ id: 'a', name: 'A', rankingPoints: 900 });
    const played = app.toWindow({ id: 'b', name: 'B', rankingPoints: 900, rankingDelta: -1100 });
    app.call('ensurePlayerRanking', fresh);
    app.call('ensurePlayerRanking', played);
    expect(fresh.rankingPoints).toBe(2000);
    expect(played.rankingPoints).toBe(900);
  });

  it('"Late joiners (0 ranking matches played) only sit if veterans cannot fill the sit slots"', () => {
    const { d } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster' });
    d.addToEvent(t, ids);
    d.generateRound(t); d.playRound(t);
    const late = d.addPlayers(1);
    d.addToEvent(t, late); // 9 present → 1 must sit
    const r = d.generateRound(t);
    expect(r.sitOutIds).toHaveLength(1);
    expect(r.sitOutIds).not.toContain(late[0]);
  });

  it('"Persist geography as homeState": legacy `state` field migrates to region/homeState on load', async () => {
    const { app } = ctx;
    app.setData({ players: [{ id: 'g1', name: 'Geo', state: 'vt' }] });
    app.call('migratePlayerHomeState');
    const p = app.state.players[0];
    expect([p.region, p.homeState, 'state' in p]).toEqual(['VT', 'VT', false]);
  });
});
