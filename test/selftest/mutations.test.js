/**
 * SELF-TEST (review F7 + audit of related guards): each regression check's
 * inputs DISTINGUISH correct behavior from broken/reversed behavior.
 *
 * Each probe boots an in-memory MUTATED copy of index.html (mutateHtml — the file
 * on disk is never touched) that reintroduces the guarded bug or reverses the
 * rule, then runs the SAME check body the regression test uses. The check must
 * fail on its main assertion — not on a "precondition:" (which would mean the
 * mutation changed the scenario instead of being caught). The unmutated checks
 * pass in test/regression/legacy-fixes.test.js (positive control).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, mutateHtml } from '../harness/loadApp.js';
import { createDriver } from '../factories/driver.js';
import { resetIds } from '../factories/players.js';
import {
  checkPartnersSharePlace, checkNonPodiumFollowsStandings, checkBackupKeepsStoredDeltas, checkLateJoinersDoNotSit,
  TEAM_SEED_CASES, checkBracketOnlyTeamRanking, checkHistoricalEventRecalculates,
} from '../regression/checks.js';
import { bronzeLoserScenario } from '../discrepancies/defs.js';
import { runMonsterNight } from '../factories/driver.js';
import { sideIds } from '../factories/oracles.js';

const MUTATIONS = {
  reverseStandingsTiebreak: [['if (a.standings !== b.standings) return a.standings - b.standings;',
    'if (a.standings !== b.standings) return b.standings - a.standings;']],
  reverseLossKey: [['if (a.losses !== b.losses) return a.losses - b.losses;',
    'if (a.losses !== b.losses) return b.losses - a.losses;']],
  splitPartners: [['        const ids = team.ids.filter(id => restIds.has(id));\n        if (!ids.length) return;',
    '        const ids = team.ids.filter(id => restIds.has(id));\n        return; // MUTATION: never group partners']],
  preferRookiesToSit: [['const pool = veterans.length ? veterans : rookies;', 'const pool = rookies.length ? rookies : veterans;']],
  wipeDeltasOnBackupLoad: [['      state.currentTournamentId = null;\n      // Preserve rankingDeltas',
    '      state.currentTournamentId = null;\n      state.tournaments.forEach(t => { if (t) { t.rankingApplied = false; delete t.rankingDeltas; delete t.rankingDeltaDetail; } });\n      // Preserve rankingDeltas']],
  // v7.28 behavior: no team seeds are read from the bracket, so a bracket-only team's expected
  // finish falls back to the average of the partners' individual club-rank positions.
  noBracketSeedBackfill: [['      // Backfill seeds from bracket sides when playoffTeams missing/incomplete (old imports)\n      try {\n        if (t.playoffs) {',
    '      // MUTATION: seed backfill disabled\n      try {\n        if (false) {']],
};

const opened = [];
afterEach(() => { while (opened.length) opened.pop().close(); });

async function mutatedApp(name, seed = 1) {
  resetIds();
  const app = await loadApp({ seed, html: mutateHtml(MUTATIONS[name]) });
  opened.push(app);
  return { app, d: createDriver(app, { seed }), boot: async () => { const a = await loadApp({ html: mutateHtml(MUTATIONS[name]) }); opened.push(a); return a; } };
}

/** Run a check and return its assertion failure (or null if it passed). */
async function failureOf(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

function expectCaught(err) {
  expect(err, 'the check must FAIL against the mutated app').toBeTruthy();
  expect(err.name).toBe('AssertionError');
  expect(err.message, 'it must fail on the guarded rule, not on a precondition').not.toContain('precondition:');
}

describe('mutation probes: each regression check catches a reintroduced bug', () => {
  it('mutateHtml refuses a mutation that does not match exactly once (no vacuous probes)', () => {
    expect(() => mutateHtml([['this text is not in index.html', 'x']])).toThrow(/exactly 1 occurrence, found 0/);
  });

  it('non-podium order (F7): reversing the standings tie-break is caught', async () => {
    const { app, d } = await mutatedApp('reverseStandingsTiebreak');
    expectCaught(await failureOf(() => checkNonPodiumFollowsStandings(app, d)));
  });

  it('evidence for F7: the PREVIOUS guard (monotonic loss counts) passes even against the reversed order', async () => {
    const { app, d } = await mutatedApp('reverseStandingsTiebreak');
    // Verbatim logic of the replaced test: every non-podium player has 2 losses, so it cannot fail.
    const { t } = runMonsterNight(app, d, { players: 16, rounds: 2 });
    const losses = {};
    for (const m of d.bracketMatches(t)) {
      if (!m.winner || (m.scoreA === 0 && m.scoreB === 0) || !m.a?.entity || !m.b?.entity) continue;
      for (const id of sideIds(m.winner === 'a' ? m.b.entity : m.a.entity)) losses[id] = (losses[id] || 0) + 1;
    }
    const rest = Object.entries(t.rankingDeltaDetail).filter(([, x]) => x.place >= 4)
      .map(([id, x]) => ({ place: x.place, losses: losses[id] || 0 })).sort((a, b) => a.place - b.place);
    expect(new Set(rest.map((r) => r.losses))).toEqual(new Set([2]));
    for (let i = 1; i < rest.length; i++) expect(rest[i].losses).toBeGreaterThanOrEqual(rest[i - 1].losses);
  });

  it('partners share a place: splitting partners into individual places is caught', async () => {
    const { app, d } = await mutatedApp('splitPartners');
    expectCaught(await failureOf(() => checkPartnersSharePlace(app, d)));
  });

  it('late joiners: preferring rookies to sit is caught', async () => {
    const { app, d } = await mutatedApp('preferRookiesToSit');
    expectCaught(await failureOf(() => checkLateJoinersDoNotSit(app, d)));
  });

  it('stored deltas on backup load: wipe-and-recalculate is caught', async () => {
    const { app, d, boot } = await mutatedApp('wipeDeltasOnBackupLoad');
    expectCaught(await failureOf(() => checkBackupKeepsStoredDeltas(app, d, boot)));
  });

  for (const c of TEAM_SEED_CASES) {
    it(`bracket-only team ranking (${c.type} ${c.format}, ${c.upset ? 'upset' : 'chalk'}): removing the bracket-seed backfill is caught`, async () => {
      const { app, d } = await mutatedApp('noBracketSeedBackfill');
      expectCaught(await failureOf(() => checkBracketOnlyTeamRanking(app, d, c)));
    });
  }

  it('historical recalculation: removing the bracket-seed backfill is caught', async () => {
    const html = mutateHtml(MUTATIONS.noBracketSeedBackfill);
    const boot = async (opts) => { const a = await loadApp({ ...opts, html }); opened.push(a); return a; };
    expectCaught(await failureOf(() => checkHistoricalEventRecalculates(boot)));
  });

  it('loss-key direction: only the single-elim bronze case (DISC-16) distinguishes it', async () => {
    // Current code: the bronze loser (2 losses) is placed after all QF losers.
    resetIds();
    const real = await loadApp({ seed: 1 }); opened.push(real);
    const base = bronzeLoserScenario(real, createDriver(real, { seed: 1 }));
    expect(base.placeOf[base.bronzeLoser]).toBe(8);
    // Reversed loss key: the bronze loser moves to 4th — so DISC-16 would report
    // "no longer reproduces" if the direction ever changed.
    const { app, d } = await mutatedApp('reverseLossKey');
    const mut = bronzeLoserScenario(app, d);
    expect(mut.placeOf[mut.bronzeLoser]).toBe(4);
  });
});
