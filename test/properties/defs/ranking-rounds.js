/**
 * Property definitions: Monster DYP / DYP ranking rounds.
 *
 * Random synthetic nights (late arrivals, departures, returns, interrupted
 * rounds, 1–4 tables) are replayed through the production code, and every
 * generated round is checked against structural invariants.
 * Registered by test/properties/ranking-rounds.property.test.js.
 */
import { expect } from 'vitest';
import { defineProperty } from '../../harness/scenario.js';
import { nightScript, replayNight } from '../../factories/scenarios.js';
import { sitAndPlayed, sideIds } from '../../factories/oracles.js';

function checkRoundStructure(t, r, before) {
  const active = new Set(before.active);
  const teamIds = r.teams.map((tm) => tm.playerIds);
  const inTeams = teamIds.flat();

  // Every team: exactly two distinct, active players
  for (const ids of teamIds) {
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    ids.forEach((id) => expect(active.has(id)).toBe(true));
  }
  // No player on two teams; sitters disjoint from players; together = active field
  expect(new Set(inTeams).size).toBe(inTeams.length);
  for (const s of r.sitOutIds) expect(inTeams.includes(s)).toBe(false);
  expect(new Set([...inTeams, ...r.sitOutIds])).toEqual(active);

  // Sit count = remainder of 4 (README: tables never cap play)
  expect(r.sitOutIds.length).toBe(active.size % 4);

  // Matches: each team in exactly one match, never against itself,
  // no player on both sides or in two matches of the same round
  const seen = new Set();
  expect(r.matches.length).toBe(r.teams.length / 2);
  for (const m of r.matches) {
    const a = sideIds(m.entityA); const b = sideIds(m.entityB);
    expect(a.filter((x) => b.includes(x))).toEqual([]);
    for (const id of [...a, ...b]) { expect(seen.has(id)).toBe(false); seen.add(id); }
  }
  expect(seen).toEqual(new Set(inTeams));
}

function checkTables(t, r, tables) {
  const live = r.matches.filter((m) => !m.onDeck && m.status !== 'done');
  const nums = live.map((m) => Number(m.table));
  expect(new Set(nums).size, 'two live matches share a table').toBe(nums.length);
  nums.forEach((n) => { expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(tables); });
  expect(live.length).toBeLessThanOrEqual(tables);
}

/** Documented priority: fewest sits first; veterans (>=1 match played) before brand-new arrivals. */
function checkSitPriority(t, r, before) {
  if (!r.sitOutIds.length) return;
  const { sits, played } = sitAndPlayed(before.rounds);
  const veterans = before.active.filter((id) => (played[id] || 0) > 0);
  if (veterans.length < r.sitOutIds.length) return; // rookies may legitimately sit
  const sitters = new Set(r.sitOutIds);
  r.sitOutIds.forEach((id) => expect((played[id] || 0) > 0, `new arrival ${id} sat while veterans available`).toBe(true));
  const maxSitterSits = Math.max(...r.sitOutIds.map((id) => sits[id] || 0));
  const others = veterans.filter((id) => !sitters.has(id)).map((id) => sits[id] || 0);
  if (others.length) expect(maxSitterSits, 'sitter has more prior sits than a playing veteran').toBeLessThanOrEqual(Math.min(...others));
}

/** No back-to-back sit while an equally-rested veteran who did not just sit is playing. */
function checkNoBackToBack(t, r, before) {
  const last = before.rounds[before.rounds.length - 1];
  if (!last) return;
  const lastSit = new Set(last.sitOutIds || []);
  const { sits, played } = sitAndPlayed(before.rounds);
  const sitters = new Set(r.sitOutIds);
  for (const s of r.sitOutIds) {
    if (!lastSit.has(s)) continue;
    const alternative = before.active.find((v) => !sitters.has(v) && !lastSit.has(v)
      && (played[v] || 0) > 0 && (sits[v] || 0) <= (sits[s] || 0) && (played[v] || 0) >= (played[s] || 0));
    expect(alternative, `player ${s} sat twice in a row although ${alternative} could have`).toBeUndefined();
  }
}

export const roundStructure = defineProperty({
  id: 'ranking-round-structure',
  title: 'every round: valid teams/sit-outs/matches, distinct tables, fair sit priority, no avoidable back-to-back sits',
  arbitrary: nightScript,
  defaultRuns: 15,
  caseBudgetMs: 8_000, // measured 150 cases: avg 1.1 s, slowest 5.8 s
  run({ app, d, scenario }) {
    replayNight(app, d, scenario, (t, r, before) => {
      checkRoundStructure(t, r, before);
      checkTables(t, r, scenario.tables);
      checkSitPriority(t, r, before);
      checkNoBackToBack(t, r, before);
    });
    expect(app.errors.map(String)).toEqual([]);
  },
});

export const steadySitSpread = defineProperty({
  id: 'ranking-round-steady-sit-spread',
  title: 'players present all night: sit-out counts differ by at most 1 (README)',
  arbitrary: nightScript,
  defaultRuns: 10,
  caseBudgetMs: 8_000, // measured 150 cases: avg 0.9 s, slowest 4.4 s
  run({ app, d, scenario }) {
    const steady = { ...scenario, ops: scenario.ops.filter((o) => o.op === 'round') };
    if (!steady.ops.length) return;
    const t = replayNight(app, d, steady);
    const { sits } = sitAndPlayed(t.rounds);
    const counts = t.playerIds.map((id) => sits[id] || 0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  },
});
