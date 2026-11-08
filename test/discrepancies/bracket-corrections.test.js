/**
 * DISCREPANCIES — bracket score corrections. Requires domain-owner review.
 * See docs/AUDIT.md (DISC-01 … DISC-05). These tests assert PROPOSED invariants
 * and are expected to fail against the current index.html; see
 * test/harness/discrepancy.js for how they are run.
 */
import { describe, expect } from 'vitest';
import fc from 'fast-check';
import { useApp } from '../harness/useApp.js';
import { fcParams } from '../harness/fcConfig.js';
import { discrepancy } from '../harness/discrepancy.js';
import { sideIds } from '../factories/oracles.js';

const ctx = useApp();
const key = (e) => sideIds(e).slice().sort().join('+');
const isBye = (m) => m.scoreA === 0 && m.scoreB === 0;

function assertNoDoubleBooking(d, t) {
  const seen = new Map();
  for (const m of d.readyBracketMatches(t)) {
    const a = sideIds(m.a.entity); const b = sideIds(m.b.entity);
    expect(a.filter((x) => b.includes(x)), `same player on both sides of ${m.id}`).toEqual([]);
    for (const id of [...a, ...b]) {
      expect(seen.get(id), `player ${id} in two ready matches`).toBeUndefined();
      seen.set(id, m.id);
    }
  }
}

function placements(t) { return t.placements || t.playoffs?.placements || {}; }

/** Build a singles bracket of n players and return helpers. */
function singlesBracket(n, format) {
  const { d } = ctx;
  const ids = d.addPlayers(n);
  const t = d.createTournament({ type: 'singles', format, tables: 4 });
  d.addToEvent(t, ids);
  d.startBracket(t);
  return t;
}

/** Re-enter a Bo1 bracket score with the opposite winner. */
function flipWinner(t, m) {
  const aWon = m.winner === 'a';
  const [a, b] = aWon ? [2, 5] : [5, 2];
  ctx.d.scoreBracket(t, m.id, a, b);
}

describe('DISC-01 correcting a bracket result keeps the bracket structurally valid', () => {
  discrepancy('DISC-01', 'after flipping an earlier result, no player is in two ready matches (random brackets)', () => {
    fc.assert(fc.property(
      fc.record({ seed: fc.integer({ min: 1, max: 1e9 }), n: fc.integer({ min: 4, max: 12 }),
        format: fc.constantFrom('single-elim', 'double-elim'), playFirst: fc.integer({ min: 3, max: 20 }) }),
      ({ seed, n, format, playFirst }) => {
        ctx.app.reset({ seed });
        const t = singlesBracket(n, format);
        const { d } = ctx;
        let played = 0;
        while (played < playFirst && d.readyBracketMatches(t).length) { d.playBracketMatch(t, d.readyBracketMatches(t)[0]); played++; }
        const done = d.bracketMatches(t).filter((m) => m.winner && !isBye(m) && m.a?.entity && m.b?.entity);
        if (done.length < 2) return;
        flipWinner(t, done[0]); // correct the EARLIEST result
        let guard = 0;
        for (;;) {
          assertNoDoubleBooking(d, t);
          const ready = d.readyBracketMatches(t);
          if (!ready.length || ++guard > 200) break;
          d.playBracketMatch(t, ready[0]);
        }
      }), { ...fcParams(25), seed: Number(process.env.FC_SEED || 20261108) }); // pinned: it.fails must fail deterministically
  });

  discrepancy('DISC-01', 'single-elim 8: after flipping a quarter-final, its new loser is in no ready match', () => {
    const t = singlesBracket(8, 'single-elim');
    const { d } = ctx;
    const qf1 = (t.playoffs.winnersRounds?.[0] || t.playoffs.rounds[0]).matches[0];
    for (let i = 0; i < 6; i++) d.playBracketMatch(t, d.readyBracketMatches(t)[0], true); // QFs + SFs, side a wins
    const eliminated = key(qf1.a.entity);
    flipWinner(t, qf1); // now side b won QF1, so side a is out
    expect(qf1.winner).toBe('b');
    for (const m of d.readyBracketMatches(t)) {
      expect([key(m.a.entity), key(m.b.entity)], `eliminated ${eliminated} still scheduled`).not.toContain(eliminated);
    }
    assertNoDoubleBooking(d, t);
  });
});

describe('DISC-02 placements stay consistent after a correction', () => {
  discrepancy('DISC-02', 'single-elim 4: after re-scoring a semi-final, 1st/2nd/3rd are distinct (or cleared)', () => {
    const t = singlesBracket(4, 'single-elim');
    const { d } = ctx;
    d.playBracketToCompletion(t, { pickWinner: () => true });
    const sf1 = (t.playoffs.winnersRounds?.[0] || t.playoffs.rounds[0]).matches[0];
    flipWinner(t, sf1);
    const p = placements(t);
    const set = [p.first, p.second, p.third].filter(Boolean).map(key);
    expect(new Set(set).size, `placements ${JSON.stringify(set)}`).toBe(set.length);
  });
});

describe('DISC-03 opening "edit score" and cancelling never changes a result', () => {
  discrepancy('DISC-03', 'Monster playoff (Bo3): open edit modal on a finished match, cancel → winner unchanged', () => {
    const { d, app } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster', tables: 2 });
    d.addToEvent(t, ids);
    for (let i = 0; i < 2; i++) { d.generateRound(t); d.playRound(t); }
    d.startPlayoffs(t);
    const m = d.readyBracketMatches(t)[0];
    d.playBracketMatch(t, m, true);
    expect(m.winner).toBe('a');
    app.call('openPlayoffScore', m.id);
    app.call('closeScoreModal');
    expect(m.winner).toBe('a');
  });

  discrepancy('DISC-03', 'Bo3 ranking round: open edit modal on a finished series, cancel → result unchanged', () => {
    const { d, app } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster', tables: 2, bestOf: 3 });
    d.addToEvent(t, ids);
    const r = d.generateRound(t);
    d.playRound(t);
    const m = r.matches[0];
    const before = { status: m.status, scoreA: m.scoreA, scoreB: m.scoreB, games: m.games.length };
    d.open(t);
    app.call('openScoreModal', r.number, m.id);
    app.call('closeScoreModal');
    expect({ status: m.status, scoreA: m.scoreA, scoreB: m.scoreB, games: m.games.length }).toEqual(before);
  });

  discrepancy('DISC-03', 'Bo3 bracket: re-entering a semi-final after the final never makes its new winner champion of a final they did not play', () => {
    const { d } = ctx;
    const ids = d.addPlayers(4);
    const t = d.createTournament({ type: 'singles', format: 'single-elim', bestOf: 3 });
    d.addToEvent(t, ids);
    d.startBracket(t);
    d.playBracketToCompletion(t, { pickWinner: () => true });
    const champion = key(placements(t).first);
    const sf = (t.playoffs.winnersRounds?.[0] || t.playoffs.rounds[0]).matches.find((m) => key(m.a.entity) === champion);
    expect(sf).toBeTruthy();
    const challenger = key(sf.b.entity);
    d.playBracketMatch(t, sf, false); // edit: side b now wins the semi 2–0
    expect(sf.winner).toBe('b');
    expect(key(placements(t).first), `${challenger} is champion without playing the final`).not.toBe(challenger);
  });
});

describe('DISC-04 a same-winner score correction only changes that match', () => {
  discrepancy('DISC-04', 'fixing 5–1 → 5–2 in a semi keeps the final result', () => {
    const t = singlesBracket(4, 'single-elim');
    const { d } = ctx;
    d.playBracketToCompletion(t, { pickWinner: () => true });
    const sf1 = (t.playoffs.winnersRounds?.[0] || t.playoffs.rounds[0]).matches[0];
    const final = d.bracketMatches(t).find((m) => m.a?.fromMatch === sf1.id || m.b?.fromMatch === sf1.id);
    const finalWinner = final.winner;
    expect(finalWinner).toBeTruthy();
    ctx.d.scoreBracket(t, sf1.id, sf1.winner === 'a' ? 5 : 1, sf1.winner === 'a' ? 1 : 5);
    expect(final.winner).toBe(finalWinner);
  });
});

describe('DISC-05 club ranking follows corrected results', () => {
  discrepancy('DISC-05', 'after a correction changes the champion, stored ranking deltas reflect the new podium', () => {
    const t = singlesBracket(4, 'single-elim');
    const { d } = ctx;
    d.playBracketToCompletion(t, { pickWinner: () => true });
    expect(t.rankingApplied).toBe(true);
    // Correct the final: other side wins
    const final = d.bracketMatches(t).find((m) => m.bracket !== 'bronze' && m !== t.playoffs.bronze
      && key(m.a?.entity) === key(placements(t).first) && m.winner === 'a' && (m.a?.fromMatch || m.b?.fromMatch));
    flipWinner(t, final);
    const champ = sideIds(placements(t).first)[0];
    expect(t.rankingDeltaDetail[champ]?.place, 'new champion still recorded with old place').toBe(1);
  });
});
