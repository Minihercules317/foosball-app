/**
 * Club ranking integrity across whole synthetic seasons.
 * README rules: points change only from finished bracket/playoff results; sandbox
 * excluded; partners share the same Δ; bonus pool = 1% of field points, locked at
 * playoff creation, split 50/30/20 (or 60/30/10).
 */
import { describe, it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { runMonsterNight } from '../factories/driver.js';

const ctx = useApp();
const pointsOf = (app) => Object.fromEntries(app.state.players.map((p) => [p.id, p.rankingPoints]));

/** A season: several Monster nights over a shared roster with varying attendance. */
function season(nights = 3) {
  const { app, d } = ctx;
  const roster = d.addPlayers(14);
  const events = [];
  for (let n = 0; n < nights; n++) {
    const present = d.rng.shuffle(roster).slice(0, d.rng.int(8, 14));
    const t = d.createTournament({ type: 'monster', tables: d.rng.int(2, 3), name: `Night ${n + 1}` });
    t.createdAt = Date.UTC(2026, 0, 1 + 7 * n); // weekly, chronological
    d.addToEvent(t, present);
    for (let r = 0; r < 3; r++) { d.generateRound(t); d.playRound(t); }
    d.startPlayoffs(t);
    d.playBracketToCompletion(t);
    events.push(t);
  }
  app.call('saveState');
  return { roster, events };
}

describe('ranking: application', () => {
  it('[contract] ranking rounds alone never change points', () => {
    const { d, app } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster' });
    d.addToEvent(t, ids);
    for (let i = 0; i < 3; i++) { d.generateRound(t); d.playRound(t); }
    app.call('toggleTournamentFinished');
    expect(t.status).toBe('finished');
    expect(Object.values(pointsOf(app)).every((p) => p === 2000)).toBe(true);
    expect(t.rankingApplied).toBeFalsy();
  });

  it('[contract] finishing a bracket applies points once; repeated triggers do not double count', () => {
    const { app, d } = ctx;
    const { t } = runMonsterNight(app, d, { players: 10 });
    expect(t.rankingApplied).toBe(true);
    const after = pointsOf(app);
    app.call('tryApplyRankingOnFinish', t);
    app.call('backfillRankingFromTournaments');
    app.call('updatePlacementsFromBracket', t);
    app.call('renderClubRanking');
    expect(pointsOf(app)).toEqual(after);
  });

  it('[contract] partners share the same Δ; podium bonuses sum to the locked pool', () => {
    const { app, d } = ctx;
    const { t } = runMonsterNight(app, d, { players: 12 });
    for (const team of t.playoffTeams) {
      const [a, b] = team.playerIds;
      expect(t.rankingDeltas[a]).toBe(t.rankingDeltas[b]);
    }
    const locked = t.bonusPoolLocked;
    expect(locked.bonusPool).toBe(Math.round(locked.fieldPoints * 0.01));
    const bonuses = Object.values(t.rankingDeltaDetail).filter((x) => x.place <= 3);
    const perPlace = [1, 2, 3].map((pl) => bonuses.find((x) => x.place === pl)?.bonus ?? 0);
    expect(perPlace.reduce((s, x) => s + x, 0)).toBe(locked.bonusPool);
  });

  it('[contract] every player Δ = seed adjustment (±8 per tier) + podium bonus', () => {
    const { app, d } = ctx;
    const { t } = runMonsterNight(app, d, { players: 12 });
    const tier = (p) => app.call('placementTierIndex', p);
    for (const det of Object.values(t.rankingDeltaDetail)) {
      expect(det.seedDelta).toBe((tier(det.expected) - tier(det.place)) * 8);
      expect(det.total).toBe(det.seedDelta + det.bonus);
      if (det.place > 3) expect(det.bonus).toBe(0);
    }
  });

  it('[contract] sandbox events never affect ranking', () => {
    const { app, d } = ctx;
    const { t } = runMonsterNight(app, d, { players: 10, sandbox: true });
    expect(t.playoffs).toBeTruthy();
    expect(t.rankingApplied).toBeFalsy();
    expect(Object.values(pointsOf(app)).every((p) => p === 2000)).toBe(true);
    app.call('recalculateClubRankingsFromEvents');
    expect(Object.values(pointsOf(app)).every((p) => p === 2000)).toBe(true);
  });

  it('[contract] players absent before playoffs keep ranking-round stats but are not in the bracket field', () => {
    const { app, d } = ctx;
    const ids = d.addPlayers(10);
    const t = d.createTournament({ type: 'monster' });
    d.addToEvent(t, ids);
    for (let i = 0; i < 2; i++) { d.generateRound(t); d.playRound(t); }
    app.call('togglePlayerAbsent', ids[0]);
    d.startPlayoffs(t);
    d.playBracketToCompletion(t);
    expect(t.playoffTeams.flatMap((x) => x.playerIds)).not.toContain(ids[0]);
    expect(t.rankingDeltas[ids[0]]).toBeUndefined();
    expect(d.player(ids[0]).rankingPoints).toBe(2000);
  });
});

describe('ranking: recalculation and history', () => {
  it('[contract] recalculating from events reproduces the incrementally applied totals', () => {
    const { app } = ctx;
    season(3);
    const incremental = pointsOf(app);
    app.call('recalculateClubRankingsFromEvents');
    expect(pointsOf(app)).toEqual(incremental);
  });

  it('[contract] recalculation is deterministic and idempotent', () => {
    const { app } = ctx;
    season(3);
    app.call('recalculateClubRankingsFromEvents');
    const once = { pts: pointsOf(app), deltas: app.state.tournaments.map((t) => t.rankingDeltas) };
    app.call('recalculateClubRankingsFromEvents');
    expect({ pts: pointsOf(app), deltas: app.state.tournaments.map((t) => t.rankingDeltas) })
      .toEqual(JSON.parse(JSON.stringify(once)));
  });

  it('[contract] stored per-event deltas rebuild the same totals (the member-device import path)', () => {
    const { app } = ctx;
    season(3);
    const totals = pointsOf(app);
    app.call('rebuildPlayerRankingPointsFromEventDeltas');
    expect(pointsOf(app)).toEqual(totals);
  });

  it('[contract] recalculation depends on event dates, not on the order events are stored', () => {
    const { app } = ctx;
    season(3);
    app.call('recalculateClubRankingsFromEvents');
    const sorted = pointsOf(app);
    app.state.tournaments.reverse();
    app.call('recalculateClubRankingsFromEvents');
    expect(pointsOf(app)).toEqual(sorted);
  });

  it('[contract] merging a duplicate player keeps club ranking consistent with event history', () => {
    const { app } = ctx;
    const { roster } = season(2);
    app.call('mergePlayerRecords', roster[0], roster[1]);
    const after = pointsOf(app);
    app.call('recalculateClubRankingsFromEvents');
    expect(pointsOf(app)).toEqual(after);
    expect(app.state.players.some((p) => p.id === roster[1])).toBe(false);
    // Every scoring-relevant reference is rewritten (rosters, teams, matches, placements, deltas).
    // Two bookkeeping fields are not — tracked as DISC-14 in test/discrepancies/.
    for (const t of app.state.tournaments) {
      const scoring = JSON.stringify({ p: t.playerIds, r: t.rounds, pl: t.playoffs, tm: t.playoffTeams, d: t.rankingDeltas, pc: t.placements });
      expect(scoring.includes(roster[1])).toBe(false);
    }
  });
});
