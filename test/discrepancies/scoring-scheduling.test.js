/**
 * DISCREPANCIES — score validation, standings, table scheduling.
 * Requires domain-owner review; see docs/AUDIT.md.
 */
import { describe, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { discrepancy } from '../harness/discrepancy.js';
import { sideIds } from '../factories/oracles.js';

const ctx = useApp();

function rankingMatch(opts = {}) {
  const { d } = ctx;
  const ids = d.addPlayers(8);
  const t = d.createTournament({ type: 'monster', ...opts });
  d.addToEvent(t, ids);
  const r = d.generateRound(t);
  return { t, r, m: r.matches[0] };
}

describe('DISC-11 overtime (win-by-2) validation', () => {
  discrepancy('DISC-11', 'race to 5 with OT accepts 7–5 (README and the app\'s own error text use it as an example)', () => {
    const { t, r, m } = rankingMatch({ raceTo: 5 });
    ctx.d.scoreRanking(t, r.number, m.id, 7, 5, { ot: true });
    expect(m.status).toBe('done');
  });

  discrepancy('DISC-11', 'race to 10 with OT rejects 8–6 (winner below the race target)', () => {
    const { t, r, m } = rankingMatch({ raceTo: 10 });
    ctx.d.scoreRanking(t, r.number, m.id, 8, 6, { ot: true });
    expect(m.status).not.toBe('done');
  });
});

describe('DISC-12 DYP ranking-round standings', () => {
  discrepancy('DISC-12', 'after a scored DYP ranking round, standings show the winners\' points', () => {
    const { d, app } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'dyp', format: 'swiss' });
    d.addToEvent(t, ids);
    d.generateRound(t);
    d.playRound(t);
    d.generateRound(t); // redraw partners for the next round
    const standings = app.call('computeStandings', t);
    const totalPts = standings.reduce((s, x) => s + (x.pts || 0), 0);
    expect(totalPts, 'round-1 wins vanished from standings').toBeGreaterThan(0);
  });
});

describe('DISC-13 table double-booking inside one event', () => {
  discrepancy('DISC-13', 'generating the next round before the current one finishes never puts two live matches on one table', () => {
    const { d } = ctx;
    const ids = d.addPlayers(16);
    const t = d.createTournament({ type: 'monster', tables: 2 });
    d.addToEvent(t, ids);
    d.generateRound(t); // round 1: 4 matches, 2 live on T1/T2
    d.generateRound(t); // round 2 drawn while round 1 still live
    const live = t.rounds.flatMap((r) => r.matches).filter((m) => m.status !== 'done' && !m.onDeck && Number(m.table) >= 1);
    const tables = live.map((m) => Number(m.table));
    expect(new Set(tables).size, `live tables ${tables}`).toBe(tables.length);
  });

  discrepancy('DISC-13', 'starting playoffs with a ranking match still live never double-books a player', () => {
    const { d } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster', tables: 2 });
    d.addToEvent(t, ids);
    d.generateRound(t); d.playRound(t);
    const r = d.generateRound(t); // leave round 2 unplayed
    d.startPlayoffs(t);
    const busy = new Map();
    const liveRanking = r.matches.filter((m) => m.status !== 'done' && !m.onDeck);
    const liveBracket = d.readyBracketMatches(t).filter((m) => !m.onDeck && Number(m.table) >= 1);
    for (const m of liveRanking) for (const id of [...sideIds(m.entityA), ...sideIds(m.entityB)]) busy.set(id, 'ranking');
    for (const m of liveBracket) for (const id of [...sideIds(m.a.entity), ...sideIds(m.b.entity)]) {
      expect(busy.get(id), `player ${id} live in a ranking match and a playoff match`).toBeUndefined();
    }
  });
});
