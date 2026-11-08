/**
 * Randomized discrepancy definitions (non-test module, so the replay entry point
 * can import them). The proposed invariant's final observation goes through
 * `disc.observe(<checkpoint>)`; see test/harness/discrepancy.js.
 */
import { expect } from 'vitest';
import fc from 'fast-check';
import { defineProperty } from '../harness/scenario.js';
import { sideIds } from '../factories/oracles.js';
import { replayNight, longNight } from '../factories/scenarios.js';
import { measureRematches } from '../factories/oracles.js';

export const isBye = (m) => m.scoreA === 0 && m.scoreB === 0;

export function assertNoDoubleBooking(d, t) {
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

/** Build a singles bracket of n players. */
export function singlesBracket(d, n, format) {
  const ids = d.addPlayers(n);
  const t = d.createTournament({ type: 'singles', format, tables: 4 });
  d.addToEvent(t, ids);
  d.startBracket(t);
  return t;
}

/** Re-enter a Bo1 bracket score with the opposite winner. */
export function flipWinner(d, t, m) {
  const aWon = m.winner === 'a';
  const [a, b] = aWon ? [2, 5] : [5, 2];
  d.scoreBracket(t, m.id, a, b);
}

export const DISC01_CHECKPOINT = 'no-double-booking-after-correction';

/** DISC-01: flip the earliest real result, then keep playing; nobody may be in two ready matches. */
export const disc01Correction = defineProperty({
  id: 'DISC-01-correction',
  title: 'after flipping an earlier result, no player is in two ready matches (random brackets)',
  arbitrary: fc.record({
    seed: fc.integer({ min: 1, max: 1e9 }), n: fc.integer({ min: 4, max: 12 }),
    format: fc.constantFrom('single-elim', 'double-elim'), playFirst: fc.integer({ min: 3, max: 20 }),
  }),
  defaultRuns: 25,
  caseBudgetMs: 8_000,
  run({ d, scenario: { n, format, playFirst }, disc }) {
    const t = singlesBracket(d, n, format);
    let played = 0;
    while (played < playFirst && d.readyBracketMatches(t).length) { d.playBracketMatch(t, d.readyBracketMatches(t)[0]); played++; }
    const done = d.bracketMatches(t).filter((m) => m.winner && !isBye(m) && m.a?.entity && m.b?.entity);
    if (done.length < 2) return;
    flipWinner(d, t, done[0]); // correct the EARLIEST result
    let guard = 0;
    for (;;) {
      disc.observe(DISC01_CHECKPOINT, () => assertNoDoubleBooking(d, t));
      const ready = d.readyBracketMatches(t);
      if (!ready.length || ++guard > 200) break;
      d.playBracketMatch(t, ready[0]);
    }
  },
});

export const DISC15_CHECKPOINT = 'repeats-within-optimum';

/** DISC-15 exploration: never more repeat partnerships than the exact optimum. */
export const disc15Exploration = defineProperty({
  id: 'DISC-15-exploration',
  title: 'never more repeat partnerships than the exact optimum (random long nights)',
  arbitrary: longNight,
  defaultRuns: 40,
  caseBudgetMs: 8_000, // measured 150 cases: avg 1.5 s, slowest 5.6 s
  run({ app, d, scenario, disc }) {
    let t;
    const rows = measureRematches((s, cb) => (t = replayNight(app, d, s, cb)), scenario);
    // The documented situation is a fully played night (partner history and sit-outs
    // depend on completed matches); without this, a broken scoring path would still
    // "reproduce" a violation — in a different scenario.
    expect(t.rounds.flatMap((r) => r.matches).every((m) => m.status === 'done'), 'setup: every round fully scored').toBe(true);
    for (const row of rows) {
      disc.observe(DISC15_CHECKPOINT, () => {
        expect(row.actual, `round ${row.round}: ${row.actual} repeats, optimum ${row.optimal} (${row.players} players)`).toBeLessThanOrEqual(row.optimal);
      });
    }
  },
});

/**
 * DISC-16 scenario: single-elim 8 with a bronze match, side a always wins.
 * Returns the bronze-match loser (a semi-finalist: 2 losses) and the four
 * quarter-final losers (1 loss each), with their finish places.
 */
export function bronzeLoserScenario(app, d) {
  const t = singlesBracket(d, 8, 'single-elim');
  d.playBracketToCompletion(t, { pickWinner: () => true });
  expect(t.status, 'setup: bracket finished').toBe('finished');
  const bronze = t.playoffs.bronze;
  expect(bronze?.winner, 'setup: a bronze match was played').toBeTruthy();
  const loserOf = (m) => sideIds(m.winner === 'a' ? m.b.entity : m.a.entity)[0];
  const bronzeLoser = loserOf(bronze);
  const qfLosers = t.playoffs.winnersRounds[0].matches.filter((m) => m.a?.entity && m.b?.entity).map(loserOf);
  expect(qfLosers, 'setup: four quarter-final losers').toHaveLength(4);
  const { placeOf } = app.call('getEventFinishPlaces', t);
  return { t, bronzeLoser, qfLosers, placeOf };
}
