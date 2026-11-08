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
import { expect } from 'vitest';
import { runMonsterNight } from '../factories/driver.js';
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
