/**
 * Regression check bodies (non-test module) shared by test/regression/legacy-fixes.test.js
 * and the mutation probes in test/selftest/mutations.test.js, which run the SAME
 * check against an in-memory mutated copy of index.html to prove the check's
 * inputs actually distinguish correct from broken behavior (review F7).
 *
 * Each check first asserts its own DISCRIMINATION PRECONDITION (labelled
 * "precondition:"), i.e. that the generated situation is one where the guarded
 * rule makes a visible difference. A check whose precondition fails is broken
 * and must be fixed, not loosened.
 */
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { runMonsterNight, runBracketOnlyTeamEvent, TEAM_EVENT_POINTS } from '../factories/driver.js';
import { lossCounts } from '../properties/defs/bracket.js';

const groupKey = (ids) => ids.slice().sort().join('+'); // same key as lossCounts()

/**
 * "old code assigned 4, 5, 6… to individual players, splitting doubles partners":
 * every playoff team's two partners share one finish place.
 */
export function checkPartnersSharePlace(app, d) {
  const { t } = runMonsterNight(app, d, { players: 12 });
  const nonPodium = t.playoffTeams.filter((team) => t.rankingDeltaDetail[team.playerIds[0]]?.place >= 4);
  expect(nonPodium.length, 'precondition: non-podium teams exist (where the old bug split partners)').toBeGreaterThanOrEqual(2);
  for (const team of t.playoffTeams) {
    const [a, b] = team.playerIds;
    expect(t.rankingDeltaDetail[a].place, `partners ${a}+${b} share a place`).toBe(t.rankingDeltaDetail[b].place);
  }
}

/**
 * Non-podium order in the weekly Monster workflow (double elimination). There,
 * every non-podium team exits with exactly 2 losses, so the "fewer losses first"
 * key cannot separate them and the documented tie-break decides: better
 * ranking-round standings → better place (4, 5, 6…). The previous guard only
 * checked monotonic loss counts, which every ordering satisfies when all counts
 * are equal. This check instead requires distinct standings and verifies the
 * exact order, so reversing the order fails it (mutation probe).
 * NOTE: it does NOT test the direction of the loss key — see DISC-16.
 */
export function checkNonPodiumFollowsStandings(app, d) {
  const { t } = runMonsterNight(app, d, { players: 16, rounds: 2 });
  const losses = lossCounts(d, t);
  const standIdx = new Map(app.call('computeStandings', t).map((s, i) => [s.id, i]));
  const groups = t.playoffTeams
    .map((team) => ({
      ids: team.playerIds,
      place: t.rankingDeltaDetail[team.playerIds[0]].place,
      losses: losses.get(groupKey(team.playerIds)) || 0,
      standing: Math.min(...team.playerIds.map((id) => standIdx.get(id) ?? 999)),
    }))
    .filter((g) => g.place >= 4);

  expect(groups.length, 'precondition: at least 3 non-podium teams').toBeGreaterThanOrEqual(3);
  expect(new Set(groups.map((g) => g.losses)).size, 'precondition: equal loss counts (double-elim)').toBe(1);
  expect(new Set(groups.map((g) => g.standing)).size, 'precondition: distinct standings, so order is decidable').toBe(groups.length);

  const byStanding = groups.slice().sort((a, b) => a.standing - b.standing);
  expect(byStanding.map((g) => g.place), 'non-podium places follow standings: 4, 5, 6…')
    .toEqual(byStanding.map((_, i) => 4 + i));
}

/**
 * "Wiping and full-recalc was overwriting stored event deltas": loading a backup
 * keeps the file's per-event deltas. The edited player is one whose real delta is
 * NON-ZERO, and the stored value (0) differs from what a recalculation produces —
 * otherwise a recalculating implementation would pass too (false-positive found
 * in the F7 audit: the old version edited whichever player came first).
 * @param {(opts?:object) => Promise<object>} boot  boots a fresh (possibly mutated) window
 */
export async function checkBackupKeepsStoredDeltas(app, d, boot) {
  const { t } = runMonsterNight(app, d, { players: 8 });
  const backup = JSON.parse(JSON.stringify(d.exportAll().data));
  const [pid, realDelta] = Object.entries(t.rankingDeltas).find(([, v]) => v !== 0) || [];
  expect(pid, 'precondition: a player with a non-zero event delta').toBeTruthy();
  expect(realDelta, 'precondition: the stored value differs from the computed one').not.toBe(0);
  backup.tournaments[0].rankingDeltas[pid] = 0; // historical value under older rules

  const device = await boot();
  device.call('applyFullBackupData', device.toWindow(backup), device.toWindow({ silent: true }));
  expect(device.state.tournaments[0].rankingDeltas[pid], 'stored delta kept').toBe(0);
  expect(device.state.players.find((p) => p.id === pid).rankingPoints, 'total rebuilt from stored delta').toBe(2000);
}

/**
 * "Late joiners (0 ranking matches played) only sit if veterans cannot fill the
 * sit slots". 8 veterans + 3 late joiners → 3 must sit; all 3 must be veterans.
 * Checked over several seeds: with random sitters the chance that no late joiner
 * sits is C(8,3)/C(11,3) ≈ 0.34 per seed, so 6 seeds leave a ≈0.15% false pass.
 * Preferring rookies (mutation probe) makes every seed fail.
 */
export function checkLateJoinersDoNotSit(app, d) {
  for (let night = 0; night < 6; night++) {
    const vets = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster', name: `Late joiners ${night}` });
    d.addToEvent(t, vets);
    d.generateRound(t); d.playRound(t);
    const late = d.addPlayers(3);
    d.addToEvent(t, late); // 11 present → 3 must sit
    const r = d.generateRound(t);
    expect(r.sitOutIds, `night ${night}: 3 sit out`).toHaveLength(3);
    for (const id of late) expect(r.sitOutIds, `night ${night}: late joiner ${id} sat while veterans could`).not.toContain(id);
  }
}

/* ------------------------------------------------------------------------------------
 * Bracket-only TEAM events: expected finish = the team's bracket seed.
 *
 * Owner-confirmed rule (2026-11-11, v7.32 "seed backfill"): in a team event that goes
 * straight to a bracket (Doubles; DYP / Monster started bracket-only) a team's expected
 * finish is its BRACKET SEED. Up to v7.28 these events stored no team seeds, so the app
 * averaged the two partners' INDIVIDUAL club-rank positions (1…8 for 8 players) and
 * compared that with a TEAM place (1…4) — which inflated every seed adjustment.
 *
 * The expected numbers below are derived by hand from the README, not from the app:
 *   Δ = (tier(expected) − tier(actual)) × 8 + podium bonus     tiers: 1 · 2 · 3–4 · 5–8
 *   bonus pool = 1% of the field's combined points, locked at bracket creation,
 *   split 50/30/20, each partner on a podium step receives that step's share.
 * Field (TEAM_EVENT_POINTS) totals 15,635 → pool 156 → shares 78 / 47 / 31.
 *
 * With 4 teams and the higher seed number winning every match ("upset"), in single AND
 * double elimination: seed 4 → 1st, seed 3 → 2nd, seed 2 → 3rd, seed 1 → 4th.
 *   seed 1: (tier 1st=0 − tier 4th=2) × 8 = −16            → −16
 *   seed 2: (tier 2nd=1 − tier 3rd=2) × 8 =  −8, + 31      → +23
 *   seed 3: (tier 3rd=2 − tier 2nd=1) × 8 =  +8, + 47      → +55
 *   seed 4: (tier 4th=2 − tier 1st=0) × 8 = +16, + 78      → +94
 * With the lower seed number winning every match ("chalk") every team finishes exactly
 * where it was seeded, so the seed adjustment is 0 and Δ is the bonus alone.
 * ---------------------------------------------------------------------------------- */
const TEAM_EVENT_POOL = 156;
const DELTA_BY_SEED = {
  upset: { 1: -16, 2: 23, 3: 55, 4: 94 },
  chalk: { 1: 78, 2: 47, 3: 31, 4: 0 },
};
const PODIUM_SEEDS = { upset: [4, 3, 2], chalk: [1, 2, 3] };
const plain = (v) => JSON.parse(JSON.stringify(v));
export const HISTORICAL_DOUBLES_FIXTURE = new URL('../fixtures/historical/doubles-bracket-only-v7.28.json', import.meta.url);

/** Each case adds something the others do not; all use 8 players / 4 teams. */
export const TEAM_SEED_CASES = [
  // fixed teams, seeds by club ranking, double elimination, every seed finishes elsewhere
  { type: 'doubles', format: 'double-elim', upset: true },
  // same teams finishing exactly as seeded: the seed adjustment must be zero
  { type: 'doubles', format: 'double-elim', upset: false },
  // teams drawn at bracket start, seeds by club ranking, single elimination (bronze match)
  { type: 'dyp', format: 'single-elim', upset: true },
  // teams drawn at bracket start, SHUFFLED seeds (not club ranking), best-of-3 series
  { type: 'monster', format: 'double-elim', upset: true },
];

/**
 * @param {object} o
 * @param {'doubles'|'dyp'|'monster'} o.type
 * @param {'single-elim'|'double-elim'} o.format
 * @param {boolean} o.upset
 */
export function checkBracketOnlyTeamRanking(app, d, { type, format, upset }) {
  const script = upset ? 'upset' : 'chalk';
  const { t, ids, seedOf, teamKey } = runBracketOnlyTeamEvent(app, d, { type, format, upset });
  const startPoints = Object.fromEntries(ids.map((id, i) => [id, TEAM_EVENT_POINTS[i]]));
  const teams = [...seedOf.entries()].map(([key, seed]) => ({ key, seed, ids: key.split('+') }));

  expect(teams.map((x) => x.seed).sort(), 'precondition: 4 teams seeded 1…4').toEqual([1, 2, 3, 4]);
  expect(teams.flatMap((x) => x.ids).sort(), 'precondition: every player is on exactly one seeded team').toEqual(ids.slice().sort());
  if (type !== 'monster') {
    // README: Doubles / DYP bracket seeds follow club ranking team strength (highest = seed 1).
    // Bracket-only Monster keeps shuffled seeds, so there the seed is simply what the bracket says.
    const byStrength = teams.slice().sort((a, b) => b.ids.reduce((s, id) => s + startPoints[id], 0) - a.ids.reduce((s, id) => s + startPoints[id], 0));
    expect(byStrength.map((x) => x.seed), 'precondition: bracket seeds follow club ranking team strength').toEqual([1, 2, 3, 4]);
  }
  expect(t.status, 'precondition: the event finished').toBe('finished');
  const pl = t.placements || t.playoffs.placements;
  expect([pl.first, pl.second, pl.third].map((e) => seedOf.get(teamKey(e))),
    `precondition: the scripted result happened (${script}: podium seeds)`).toEqual(PODIUM_SEEDS[script]);
  expect((t.bonusPoolLocked || t.playoffs.bonusPoolLocked).bonusPool, 'precondition: locked pool = 1% of 15,635').toBe(TEAM_EVENT_POOL);
  expect(t.playoffTeams || [], 'precondition: a bracket-only event stores no playoff teams (the case the rule is about)').toHaveLength(0);

  const expectedDelta = {}; const expectedSeed = {}; const expectedPoints = {};
  for (const team of teams) for (const id of team.ids) {
    expectedDelta[id] = DELTA_BY_SEED[script][team.seed];
    expectedSeed[id] = team.seed;
    expectedPoints[id] = startPoints[id] + expectedDelta[id];
  }
  expect(plain(t.rankingDeltas), `${type} ${script}: ranking Δ follows the team's bracket seed`).toEqual(expectedDelta);
  expect(Object.fromEntries(ids.map((id) => [id, t.rankingDeltaDetail[id].expected])),
    `${type} ${script}: expected finish is the team's bracket seed`).toEqual(expectedSeed);
  expect(Object.fromEntries(ids.map((id) => [id, d.player(id).rankingPoints])),
    `${type} ${script}: club points = start + Δ`).toEqual(expectedPoints);
}

/**
 * Historical recalculation. The fixture is the saved device state of a FABRICATED
 * bracket-only Doubles event that was really played and scored by v7.28 (see its
 * `provenance`; regenerate with scripts/generate-fixtures.mjs --historical). It is the
 * "upset" scenario above with fixed teams p1+p2 (seed 4), p3+p4 (seed 2), p5+p6 (seed 1),
 * p7+p8 (seed 3), so its stored deltas are the OLD ones:
 *   p1+p2  expected round((8+7)/2)=8 → 1st: (3−0)×8 + 78 = 102
 *   p7+p8  expected round((6+5)/2)=6 → 2nd: (3−1)×8 + 47 =  63
 *   p3+p4  expected round((3+2)/2)=3 → 3rd: (2−2)×8 + 31 =  31
 *   p5+p6  expected round((1+4)/2)=3 → 4th: (2−2)×8      =   0
 * "Recalculate ranking from events" resets everyone to 2,000 and replays the event; the
 * owner confirmed it must then apply the corrected rule (bracket seed, locked bonus pool).
 * @param {(opts?:object) => Promise<object>} boot  boots a fresh (possibly mutated) window
 */
export async function checkHistoricalEventRecalculates(boot) {
  const fixture = JSON.parse(readFileSync(HISTORICAL_DOUBLES_FIXTURE, 'utf8'));
  const pair = (a, b, v) => ({ [`p_000${a}`]: v, [`p_000${b}`]: v });
  const oldDeltas = { ...pair(1, 2, 102), ...pair(7, 8, 63), ...pair(3, 4, 31), ...pair(5, 6, 0) };
  const corrected = { ...pair(1, 2, 94), ...pair(7, 8, 55), ...pair(3, 4, 23), ...pair(5, 6, -16) };
  const pointsOf = (app) => Object.fromEntries(app.state.players.map((p) => [p.id, p.rankingPoints]));

  expect(fixture.provenance.appVersion, 'precondition: the fixture was produced by v7.28').toBe('7.28');
  const app = await boot({ data: fixture.data });
  expect(app.state.tournaments, 'precondition: one historical event loaded').toHaveLength(1);
  const t = app.state.tournaments[0];
  expect(plain(t.rankingDeltas), 'precondition: loading keeps the stored OLD-formula deltas').toEqual(oldDeltas);

  expect(app.call('recalculateClubRankingsFromEvents'), 'precondition: recalculation replays the one event').toBe(1);
  expect(plain(app.state.tournaments[0].rankingDeltas), 'recalculated Δ follows the team\'s bracket seed').toEqual(corrected);
  expect(pointsOf(app), 'recalculated club points = 2,000 + corrected Δ')
    .toEqual(Object.fromEntries(Object.entries(corrected).map(([id, v]) => [id, 2000 + v])));

  app.call('recalculateClubRankingsFromEvents');
  expect(plain(app.state.tournaments[0].rankingDeltas), 'recalculating again gives the same Δ').toEqual(corrected);
  expect(app.stored().tournaments[0].rankingDeltas, 'the corrected Δ is what gets saved').toEqual(corrected);
}
