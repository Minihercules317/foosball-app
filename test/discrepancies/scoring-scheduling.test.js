/**
 * DISCREPANCIES — score validation, standings, table scheduling.
 * Requires domain-owner review; see docs/AUDIT.md. Each fails at its declared checkpoint.
 */
import { describe, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { discrepancy } from '../harness/discrepancy.js';
import { sideIds } from '../factories/oracles.js';

const ctx = useApp();
/** Newest toast element. submitScore always appends one ("Score saved" or a rejection);
 *  the app trims old toasts, so compare identity, not counts. */
const lastToast = () => ctx.app.window.document.getElementById('toast-container').lastElementChild;

function rankingMatch(opts = {}) {
  const { d } = ctx;
  const ids = d.addPlayers(8);
  const t = d.createTournament({ type: 'monster', ...opts });
  d.addToEvent(t, ids);
  const r = d.generateRound(t);
  return { t, r, m: r.matches[0] };
}

describe('DISC-11 overtime (win-by-2) validation', () => {
  discrepancy('DISC-11', 'race to 5 with OT accepts 7–5 (README and the app\'s own error text use it as an example)', { checkpoint: 'ot-score-accepted' }, (disc) => {
    const { t, r, m } = rankingMatch({ raceTo: 5 });
    expect(m.status, 'setup: match not yet scored').not.toBe('done');
    const before = lastToast();
    ctx.d.scoreRanking(t, r.number, m.id, 7, 5, { ot: true });
    // Outcome-neutral prerequisite: the submit path ran (accepted or rejected).
    expect(!!lastToast() && lastToast() !== before, 'setup: submitScore ran and gave feedback').toBe(true);
    disc.observe('ot-score-accepted', () => expect(m.status).toBe('done'));
  });

  discrepancy('DISC-11', 'race to 10 with OT rejects 8–6 (winner below the race target)', { checkpoint: 'short-score-rejected' }, (disc) => {
    const { t, r, m } = rankingMatch({ raceTo: 10 });
    expect(m.status, 'setup: match not yet scored').not.toBe('done');
    const before = lastToast();
    ctx.d.scoreRanking(t, r.number, m.id, 8, 6, { ot: true });
    expect(!!lastToast() && lastToast() !== before, 'setup: submitScore ran and gave feedback').toBe(true);
    disc.observe('short-score-rejected', () => expect(m.status).not.toBe('done'));
  });
});

describe('DISC-12 DYP ranking-round standings', () => {
  discrepancy('DISC-12', 'after a scored DYP ranking round, standings show the winners\' points', { checkpoint: 'standings-keep-points' }, (disc) => {
    const { d, app } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'dyp', format: 'swiss' });
    d.addToEvent(t, ids);
    d.generateRound(t);
    d.playRound(t);
    expect(t.rounds[0].matches.every((m) => m.status === 'done'), 'setup: round 1 fully scored').toBe(true);
    d.generateRound(t); // redraw partners for the next round
    expect(t.rounds, 'setup: round 2 drawn').toHaveLength(2);
    const standings = app.call('computeStandings', t);
    const totalPts = standings.reduce((s, x) => s + (x.pts || 0), 0);
    disc.observe('standings-keep-points', () => expect(totalPts, 'round-1 wins vanished from standings').toBeGreaterThan(0));
  });
});

describe('DISC-13 table double-booking inside one event', () => {
  discrepancy('DISC-13', 'generating the next round before the current one finishes never puts two live matches on one table', { checkpoint: 'distinct-live-tables' }, (disc) => {
    const { d } = ctx;
    const ids = d.addPlayers(16);
    const t = d.createTournament({ type: 'monster', tables: 2 });
    d.addToEvent(t, ids);
    d.generateRound(t); // round 1: 4 matches, 2 live on T1/T2
    d.generateRound(t); // round 2 drawn while round 1 still live
    expect(t.rounds, 'setup: two rounds drawn').toHaveLength(2);
    const live = t.rounds.flatMap((r) => r.matches).filter((m) => m.status !== 'done' && !m.onDeck && Number(m.table) >= 1);
    const tables = live.map((m) => Number(m.table));
    disc.observe('distinct-live-tables', () => expect(new Set(tables).size, `live tables ${tables}`).toBe(tables.length));
  });

  discrepancy('DISC-13', 'starting playoffs with a ranking match still live never double-books a player', { checkpoint: 'no-player-in-two-live-matches' }, (disc) => {
    const { d } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster', tables: 2 });
    d.addToEvent(t, ids);
    d.generateRound(t); d.playRound(t);
    expect(t.rounds[0].matches.every((m) => m.status === 'done'), 'setup: round 1 fully scored').toBe(true);
    const r = d.generateRound(t); // leave round 2 unplayed
    d.startPlayoffs(t);
    expect(t.playoffs, 'setup: playoffs started').toBeTruthy();
    const busy = new Map();
    const liveRanking = r.matches.filter((m) => m.status !== 'done' && !m.onDeck);
    const liveBracket = d.readyBracketMatches(t).filter((m) => !m.onDeck && Number(m.table) >= 1);
    for (const m of liveRanking) for (const id of [...sideIds(m.entityA), ...sideIds(m.entityB)]) busy.set(id, 'ranking');
    disc.observe('no-player-in-two-live-matches', () => {
      for (const m of liveBracket) for (const id of [...sideIds(m.a.entity), ...sideIds(m.b.entity)]) {
        expect(busy.get(id), `player ${id} live in a ranking match and a playoff match`).toBeUndefined();
      }
    });
  });
});
