/**
 * Independent reference computations ("oracles") used by property tests.
 * These are written from the README rules, NOT copied from index.html, so they
 * can catch cases where the implementation drifts from the documented intent.
 */

export const pk = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Set of partner pairs used in all given rounds (from round.teams). */
export function priorPartnerPairs(rounds) {
  const s = new Map();
  for (const r of rounds) for (const team of r.teams || []) {
    const [a, b] = team.playerIds || [];
    if (a && b) s.set(pk(a, b), (s.get(pk(a, b)) || 0) + 1);
  }
  return s;
}

/**
 * Exact minimum number of repeated partnerships achievable when pairing `ids`
 * (even length) given prior pairs. Bitmask DP; fine for <= ~22 players.
 */
export function minRematches(ids, prior) {
  const n = ids.length;
  if (n % 2) throw new Error('odd');
  const memo = new Map();
  const full = (1 << n) - 1;
  const go = (mask) => {
    if (mask === full) return 0;
    if (memo.has(mask)) return memo.get(mask);
    let i = 0;
    while (mask & (1 << i)) i++;
    let best = Infinity;
    for (let j = i + 1; j < n; j++) {
      if (mask & (1 << j)) continue;
      const cost = prior.has(pk(ids[i], ids[j])) ? 1 : 0;
      const v = cost + go(mask | (1 << i) | (1 << j));
      if (v < best) best = v;
      if (best === 0) break;
    }
    memo.set(mask, best);
    return best;
  };
  return go(0);
}

/** Per-player sit-out and played counts from a list of rounds. */
export function sitAndPlayed(rounds) {
  const sits = {}; const played = {};
  for (const r of rounds) {
    for (const id of r.sitOutIds || []) sits[id] = (sits[id] || 0) + 1;
    for (const m of r.matches || []) for (const e of [m.entityA, m.entityB]) {
      for (const id of e?.playerIds || (e?.id ? [e.id] : [])) played[id] = (played[id] || 0) + 1;
    }
  }
  return { sits, played };
}

/** Player ids on a ranking/bracket match side. */
export const sideIds = (ent) => (ent?.playerIds?.length ? [...ent.playerIds] : ent?.id ? [ent.id] : []);

/**
 * Replay a night and, for every round, compare the number of repeat partnerships
 * the app drew with the exact optimum for the same playing set.
 * `replay(script, onRound)` is typically `(s, cb) => replayNight(app, d, s, cb)`.
 */
export function measureRematches(replay, script) {
  const rows = [];
  replay(script, (t, r, before) => {
    const prior = priorPartnerPairs(before.rounds);
    const playing = r.teams.flatMap((tm) => tm.playerIds);
    const actual = r.teams.filter((tm) => prior.has(pk(...tm.playerIds))).length;
    rows.push({ round: r.number, actual, optimal: minRematches(playing, prior), players: playing.length, teams: r.teams.map((x) => x.playerIds) });
  });
  return rows;
}
