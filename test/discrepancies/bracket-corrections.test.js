/**
 * DISCREPANCIES — bracket score corrections. Requires domain-owner review.
 * See docs/AUDIT.md (DISC-01 … DISC-05). These tests assert PROPOSED invariants
 * and are expected to fail against the current index.html AT THEIR DECLARED
 * CHECKPOINT; see test/harness/discrepancy.js for how they are classified.
 */
import { describe, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { checkProperty, runScenario } from '../harness/scenario.js';
import { discrepancy } from '../harness/discrepancy.js';
import { sideIds } from '../factories/oracles.js';
import { assertNoDoubleBooking, singlesBracket, flipWinner, disc01Correction, DISC01_CHECKPOINT } from './defs.js';
import { readFileSync } from 'node:fs';

const ctx = useApp();
const key = (e) => sideIds(e).slice().sort().join('+');
function placements(t) { return t.placements || t.playoffs?.placements || {}; }
const firstRound = (t) => (t.playoffs.winnersRounds?.[0] || t.playoffs.rounds[0]).matches;

/** Saved counterexample (scenario fixture) found by the DISC-01 property; replays alone. */
const DISC01_FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/scenarios/DISC-01-correction.json', import.meta.url), 'utf8'));

describe('DISC-01 correcting a bracket result keeps the bracket structurally valid', () => {
  discrepancy('DISC-01', 'after flipping an earlier result, no player is in two ready matches (random brackets)',
    { checkpoint: DISC01_CHECKPOINT },
    (disc) => checkProperty(disc01Correction, { disc }));

  discrepancy('DISC-01', `saved scenario ${JSON.stringify(DISC01_FIXTURE.scenario)}: no player is in two ready matches after the correction`,
    { checkpoint: DISC01_CHECKPOINT },
    (disc) => runScenario(DISC01_FIXTURE.scenario, (c) => disc01Correction.run({ ...c, disc })));

  discrepancy('DISC-01', 'single-elim 8: after flipping a quarter-final, its new loser is in no ready match',
    { checkpoint: 'eliminated-player-not-scheduled' }, (disc) => {
      const { d } = ctx;
      const t = singlesBracket(d, 8, 'single-elim');
      const qf1 = firstRound(t)[0];
      for (let i = 0; i < 6; i++) d.playBracketMatch(t, d.readyBracketMatches(t)[0], true); // QFs + SFs, side a wins
      const eliminated = key(qf1.a.entity);
      flipWinner(d, t, qf1); // now side b won QF1, so side a is out
      expect(qf1.winner, 'setup: the correction was recorded').toBe('b');
      disc.observe('eliminated-player-not-scheduled', () => {
        for (const m of d.readyBracketMatches(t)) {
          expect([key(m.a.entity), key(m.b.entity)], `eliminated ${eliminated} still scheduled`).not.toContain(eliminated);
        }
        assertNoDoubleBooking(d, t);
      });
    });
});

describe('DISC-02 placements stay consistent after a correction', () => {
  discrepancy('DISC-02', 'single-elim 4: after re-scoring a semi-final, 1st/2nd/3rd are distinct (or cleared)',
    { checkpoint: 'distinct-podium' }, (disc) => {
      const { d } = ctx;
      const t = singlesBracket(d, 4, 'single-elim');
      d.playBracketToCompletion(t, { pickWinner: () => true });
      expect(t.status, 'setup: bracket finished').toBe('finished');
      const sf1 = firstRound(t)[0];
      const before = sf1.winner;
      flipWinner(d, t, sf1);
      expect(sf1.winner, 'setup: the correction was recorded').not.toBe(before);
      disc.observe('distinct-podium', () => {
        const p = placements(t);
        const set = [p.first, p.second, p.third].filter(Boolean).map(key);
        expect(new Set(set).size, `placements ${JSON.stringify(set)}`).toBe(set.length);
      });
    });
});

describe('DISC-03 opening "edit score" and cancelling never changes a result', () => {
  discrepancy('DISC-03', 'Monster playoff (Bo3): open edit modal on a finished match, cancel → winner unchanged',
    { checkpoint: 'winner-after-cancel' }, (disc) => {
      const { d, app } = ctx;
      const ids = d.addPlayers(8);
      const t = d.createTournament({ type: 'monster', tables: 2 });
      d.addToEvent(t, ids);
      for (let i = 0; i < 2; i++) { d.generateRound(t); d.playRound(t); }
      d.startPlayoffs(t);
      const m = d.readyBracketMatches(t)[0];
      expect(m, 'setup: a ready playoff match').toBeTruthy();
      d.playBracketMatch(t, m, true);
      expect(m.winner, 'setup: the playoff match was won by side a').toBe('a');
      app.call('openPlayoffScore', m.id);
      app.call('closeScoreModal');
      disc.observe('winner-after-cancel', () => expect(m.winner).toBe('a'));
    });

  discrepancy('DISC-03', 'Bo3 ranking round: open edit modal on a finished series, cancel → result unchanged',
    { checkpoint: 'series-after-cancel' }, (disc) => {
      const { d, app } = ctx;
      const ids = d.addPlayers(8);
      const t = d.createTournament({ type: 'monster', tables: 2, bestOf: 3 });
      d.addToEvent(t, ids);
      const r = d.generateRound(t);
      d.playRound(t);
      const m = r.matches[0];
      expect(m.status, 'setup: the series was completed').toBe('done');
      const before = { status: m.status, scoreA: m.scoreA, scoreB: m.scoreB, games: m.games.length };
      d.open(t);
      app.call('openScoreModal', r.number, m.id);
      app.call('closeScoreModal');
      disc.observe('series-after-cancel', () => {
        expect({ status: m.status, scoreA: m.scoreA, scoreB: m.scoreB, games: m.games.length }).toEqual(before);
      });
    });

  discrepancy('DISC-03', 'Bo3 bracket: re-entering a semi-final after the final never makes its new winner champion of a final they did not play',
    { checkpoint: 'champion-played-final' }, (disc) => {
      const { d } = ctx;
      const ids = d.addPlayers(4);
      const t = d.createTournament({ type: 'singles', format: 'single-elim', bestOf: 3 });
      d.addToEvent(t, ids);
      d.startBracket(t);
      d.playBracketToCompletion(t, { pickWinner: () => true });
      const champion = key(placements(t).first);
      const sf = firstRound(t).find((m) => key(m.a.entity) === champion);
      expect(sf, 'setup: the champion\'s semi-final').toBeTruthy();
      const challenger = key(sf.b.entity);
      d.playBracketMatch(t, sf, false); // edit: side b now wins the semi 2–0
      expect(sf.winner, 'setup: the semi-final correction was recorded').toBe('b');
      disc.observe('champion-played-final', () => {
        expect(key(placements(t).first), `${challenger} is champion without playing the final`).not.toBe(challenger);
      });
    });
});

describe('DISC-04 a same-winner score correction only changes that match', () => {
  discrepancy('DISC-04', 'fixing 5–1 → 5–2 in a semi keeps the final result',
    { checkpoint: 'final-result-kept' }, (disc) => {
      const { d } = ctx;
      const t = singlesBracket(d, 4, 'single-elim');
      d.playBracketToCompletion(t, { pickWinner: () => true });
      const sf1 = firstRound(t)[0];
      const final = d.bracketMatches(t).find((m) => m.a?.fromMatch === sf1.id || m.b?.fromMatch === sf1.id);
      expect(final, 'setup: the final fed by semi-final 1').toBeTruthy();
      const finalWinner = final.winner;
      expect(finalWinner, 'setup: the final was played').toBeTruthy();
      const winnerBefore = sf1.winner;
      d.scoreBracket(t, sf1.id, sf1.winner === 'a' ? 5 : 1, sf1.winner === 'a' ? 1 : 5);
      expect(sf1.winner, 'setup: same winner after the score fix').toBe(winnerBefore);
      disc.observe('final-result-kept', () => expect(final.winner).toBe(finalWinner));
    });
});

describe('DISC-05 club ranking follows corrected results', () => {
  discrepancy('DISC-05', 'after a correction changes the champion, stored ranking deltas reflect the new podium',
    { checkpoint: 'new-champion-ranked-first' }, (disc) => {
      const { d } = ctx;
      const t = singlesBracket(d, 4, 'single-elim');
      d.playBracketToCompletion(t, { pickWinner: () => true });
      expect(t.rankingApplied, 'setup: ranking applied on finish').toBe(true);
      const oldChampion = key(placements(t).first);
      // Correct the final: other side wins
      const final = d.bracketMatches(t).find((m) => m.bracket !== 'bronze' && m !== t.playoffs.bronze
        && key(m.a?.entity) === key(placements(t).first) && m.winner === 'a' && (m.a?.fromMatch || m.b?.fromMatch));
      expect(final, 'setup: the final').toBeTruthy();
      flipWinner(d, t, final);
      const champ = sideIds(placements(t).first)[0];
      expect(champ, 'setup: the correction changed the champion').toBeTruthy();
      expect(champ, 'setup: the correction changed the champion').not.toBe(oldChampion);
      disc.observe('new-champion-ranked-first', () => {
        expect(t.rankingDeltaDetail[champ]?.place, 'new champion still recorded with old place').toBe(1);
      });
    });
});
