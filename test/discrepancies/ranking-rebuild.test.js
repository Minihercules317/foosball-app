/**
 * DISCREPANCY DISC-17 — an ordinary bracket completion rebuilds EVERY player's club points
 * from retained event deltas. Owner-ACCEPTED for now (2026-11-11); tracked here so a future
 * change is detected. See docs/AUDIT.md (DISC-17) for trigger, cause and affected data.
 *
 * Trigger (v7.34, index.html submitBracketScore): the submission that finishes a bracket runs
 * updatePlacementsFromBracket() → tryApplyRankingOnFinish(), which sets t.rankingApplied.
 * submitBracketScore() then sees `prevWinner || t.rankingApplied` and treats the ordinary
 * finish like a correction: reapplyRankingAfterBracketCorrection() drops this event's deltas,
 * calls rebuildPlayerRankingPointsFromEventDeltas() — every player reset to 2,000, then the
 * STORED rankingDeltas of the remaining events replayed (not recomputed from results) — and
 * applies this event again. Points not represented by a retained event delta are lost.
 *
 * Scenario: the data state the owner confirmed is legitimate — a ranked event is deleted,
 * and its contribution stays in the totals "until a recalculation" (owner rule 6). Then an
 * unrelated Singles bracket with OTHER players is played normally, each match scored once.
 *
 * Proposed invariant (checkpoint 'points-change-only-by-event-delta'): finishing an event
 * changes each player's club points by exactly that event's Δ for them (0 if absent).
 * If the rebuild is removed or made incremental, this reports NO LONGER REPRODUCES; if
 * deleting an event starts removing its contribution immediately, the setup assertion
 * fails as UNEXPECTED — either way the change is surfaced, not silently absorbed.
 *
 * This is NOT about the 2,000 starting value itself (owner-confirmed and intended).
 *
 * v7.42 status (2026-11-12): UNEXPECTED FAILURE at the rule-6 setup assertion, as anticipated
 * above. confirmDeleteTournament now runs rebuildPlayerRankingPointsFromEventDeltas() itself, so
 * the deleted night's players drop back to 2,000 + their remaining deltas on deletion. The
 * mechanism this check documents is UNCHANGED in v7.42 (submitBracketScore still treats an
 * ordinary finish as a correction and rebuilds every player from retained deltas), but deletion
 * no longer leaves the data state the scenario relies on. The test is left as is, red, pending
 * the owner's decision on rule 6 (docs/AUDIT.md, DISC-09/DISC-17).
 */
import { describe, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { discrepancy } from '../harness/discrepancy.js';
import { runMonsterNight } from '../factories/driver.js';
import { singlesBracket } from './defs.js';

const ctx = useApp();
const pointsOf = (app) => Object.fromEntries(app.state.players.map((p) => [p.id, p.rankingPoints]));

describe('DISC-17 automatic ranking rebuild on ordinary bracket completion', () => {
  discrepancy('DISC-17', 'finishing an unrelated bracket keeps a deleted event\'s contribution (changes points only by the new event\'s Δ)',
    { checkpoint: 'points-change-only-by-event-delta' }, (disc) => {
      const { app, d } = ctx;
      // 1) A ranked Monster night, then delete it (owner rule 6: its contribution may stay
      //    in the current totals until a recalculation).
      const { t: night, ids: nightIds } = runMonsterNight(app, d, { players: 8, name: 'Deleted night' });
      expect(night.rankingApplied, 'setup: the night was ranked').toBe(true);
      expect(nightIds.some((id) => d.player(id).rankingPoints !== 2000), 'setup: the night moved someone off 2,000').toBe(true);
      const afterNight = pointsOf(app);
      d.open(night);
      app.call('confirmDeleteTournament');
      expect(app.state.tournaments.some((x) => x.id === night.id), 'setup: the ranked night was deleted').toBe(false);
      expect(pointsOf(app), 'setup: deleting keeps its contribution until a recalculation (owner rule 6)').toEqual(afterNight);

      // 2) An ordinary, unrelated Singles bracket (4 NEW players), every match scored once.
      const before = pointsOf(app);
      const t = singlesBracket(d, 4, 'single-elim');
      const submissions = d.playBracketToCompletion(t, { pickWinner: () => true });
      const played = d.bracketMatches(t).filter((m) => m.winner && m.a?.entity && m.b?.entity);
      expect(submissions, 'setup: ordinary play — one submission per played match, no corrections').toBe(played.length);
      expect([t.status, t.rankingApplied], 'setup: the new bracket finished and was ranked').toEqual(['finished', true]);
      const newIds = t.playerIds;
      expect(newIds.filter((id) => nightIds.includes(id)), 'setup: no player is in both events').toEqual([]);

      disc.observe('points-change-only-by-event-delta', () => {
        const expected = Object.fromEntries(Object.entries(before).map(([id, p]) => [id, p + (Number(t.rankingDeltas[id]) || 0)]));
        expect(pointsOf(app), 'club points after an ordinary finish = before + this event\'s Δ').toEqual(expected);
      });
    });
});
