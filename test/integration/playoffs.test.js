/**
 * Monster playoffs: README "Tiered playoffs: top half of standings pairs with
 * bottom half (e.g. 1+6, 2+7, …)", Bo3, double elimination.
 */
import { describe, it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { pk } from '../factories/oracles.js';

const ctx = useApp();

function nightToPlayoffs(n, { absent = 0 } = {}) {
  const { app, d } = ctx;
  const ids = d.addPlayers(n);
  const t = d.createTournament({ type: 'monster', tables: 3 });
  d.addToEvent(t, ids);
  for (let i = 0; i < 3; i++) { d.generateRound(t); d.playRound(t); }
  for (let i = 0; i < absent; i++) app.call('togglePlayerAbsent', ids[i]);
  const standings = app.call('computeStandings', t).map((s) => s.id).filter((id) => !(t.absentIds || []).includes(id));
  d.startPlayoffs(t);
  return { t, standings };
}

describe('Monster tiered playoffs', () => {
  for (const n of [8, 10, 12]) {
    it(`[contract] ${n} players: rank i partners rank i + ${n / 2}`, () => {
      const { t, standings } = nightToPlayoffs(n);
      const half = n / 2;
      const expected = new Set(standings.slice(0, half).map((id, i) => pk(id, standings[i + half])));
      expect(new Set(t.playoffTeams.map((x) => pk(...x.playerIds)))).toEqual(expected);
      expect(t.playoffs.type || t.playoffs.size).toBeTruthy();
      expect(ctx.app.call('getTournamentBestOf', t, 'playoff')).toBe(3);
    });
  }

  it('[char] odd field: the lowest-ranked eligible player sits out of the playoffs', () => {
    const { t, standings } = nightToPlayoffs(11);
    const inPlayoffs = new Set(t.playoffTeams.flatMap((x) => x.playerIds));
    expect(inPlayoffs.size).toBe(10);
    expect(inPlayoffs.has(standings[standings.length - 1])).toBe(false);
  });

  it('[contract] absent players are excluded from playoff teams', () => {
    const { t } = nightToPlayoffs(10, { absent: 2 });
    const inPlayoffs = new Set(t.playoffTeams.flatMap((x) => x.playerIds));
    for (const id of t.absentIds) expect(inPlayoffs.has(id)).toBe(false);
    expect(inPlayoffs.size).toBe(8);
  });
});
