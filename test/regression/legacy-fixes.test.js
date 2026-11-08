/**
 * [regression] Guards for bugs that index.html's own comments say were fixed in
 * earlier releases. Each test cites the comment it protects. Check bodies live in
 * ./checks.js so test/selftest/mutations.test.js can prove each one FAILS against
 * a mutated copy of the app that reintroduces the bug (or reverses the rule).
 */
import { describe, it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { loadApp } from '../harness/loadApp.js';
import { checkPartnersSharePlace, checkNonPodiumFollowsStandings, checkBackupKeepsStoredDeltas, checkLateJoinersDoNotSit } from './checks.js';

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
    checkPartnersSharePlace(ctx.app, ctx.d);
  });

  it('"Previous sort … inverted seed places" (narrowed): Monster double-elim non-podium places follow ranking-round standings', () => {
    // All non-podium teams have 2 losses in double elimination, so this guards the
    // order the weekly workflow actually produces, not the loss-key direction
    // (only single-elim bronze losers differ in losses — see DISC-16).
    checkNonPodiumFollowsStandings(ctx.app, ctx.d);
  });

  it('"Wiping and full-recalc was overwriting stored event deltas": loading a backup keeps the file\'s per-event deltas', async () => {
    const opened = [];
    try {
      await checkBackupKeepsStoredDeltas(ctx.app, ctx.d, async () => { const a = await loadApp(); opened.push(a); return a; });
    } finally { opened.forEach((a) => a.close()); }
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
    checkLateJoinersDoNotSit(ctx.app, ctx.d);
  });

  it('"Persist geography as homeState": legacy `state` field migrates to region/homeState on load', async () => {
    const { app } = ctx;
    app.setData({ players: [{ id: 'g1', name: 'Geo', state: 'vt' }] });
    app.call('migratePlayerHomeState');
    const p = app.state.players[0];
    expect([p.region, p.homeState, 'state' in p]).toEqual(['VT', 'VT', false]);
  });
});
