/**
 * [regression] Bracket-only team events rank by the team's BRACKET SEED.
 *
 * v7.32 ("seed backfill") changed club ranking for team events that go straight to a
 * bracket: expected finish is now the team's bracket seed instead of the average of the
 * partners' individual club-rank positions. The owner confirmed on 2026-11-11 that the
 * old calculation was wrong and that recalculating past events with the corrected rule
 * is intended. Expected values are hand-derived from the README in ./checks.js, which
 * also explains them; test/selftest/mutations.test.js proves each check fails when the
 * backfill is removed (i.e. against the v7.28 behavior).
 */
import { describe, it } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { loadApp } from '../harness/loadApp.js';
import { TEAM_SEED_CASES, checkBracketOnlyTeamRanking, checkHistoricalEventRecalculates } from './checks.js';

const ctx = useApp();

describe('bracket-only team events: expected finish is the team bracket seed', () => {
  for (const c of TEAM_SEED_CASES) {
    it(`[regression] ${c.type} ${c.format}, ${c.upset ? 'upset (higher seed number always wins)' : 'chalk (every team finishes as seeded)'}: Δ and club points match the hand-derived table`, () => {
      checkBracketOnlyTeamRanking(ctx.app, ctx.d, c);
    });
  }

  it('[regression] a historical v7.28 Doubles event (stored old deltas) is recalculated with the corrected rule', async () => {
    const opened = [];
    try {
      await checkHistoricalEventRecalculates(async (opts) => { const a = await loadApp(opts); opened.push(a); return a; });
    } finally { opened.forEach((a) => a.close()); }
  });
});
