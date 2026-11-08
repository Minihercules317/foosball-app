/**
 * Property used by test/selftest/replay.test.js to demonstrate independent replay.
 * Its case body plays a real Monster night through the production code and
 * returns an observation trace (partners, sit-outs, tables, scores).
 * Hooks let the self-test record traces and decide which case "fails".
 */
import { expect } from 'vitest';
import fc from 'fast-check';
import { defineProperty } from '../harness/scenario.js';

export const hooks = { record: null, failWhen: null };

export function nightTrace(app, d, { players, rounds }) {
  const ids = d.addPlayers(players);
  const t = d.createTournament({ type: 'monster', tables: 2 });
  d.addToEvent(t, ids);
  const trace = [];
  for (let i = 0; i < rounds; i++) {
    const r = d.generateRound(t);
    d.playRound(t);
    trace.push({
      teams: r.teams.map((tm) => tm.playerIds.join('+')),
      sit: r.sitOutIds.slice(),
      matches: r.matches.map((m) => [m.table ?? null, m.scoreA, m.scoreB]),
    });
  }
  return trace;
}

export const replayDemo = defineProperty({
  id: 'selftest-replay-demo',
  title: 'replay demo: a Monster night trace',
  arbitrary: fc.record({ seed: fc.integer({ min: 1, max: 2 ** 31 - 1 }), players: fc.integer({ min: 5, max: 11 }), rounds: fc.integer({ min: 1, max: 3 }) }),
  defaultRuns: 6,
  caseBudgetMs: 8_000,
  run({ app, d, scenario }) {
    const trace = nightTrace(app, d, scenario);
    if (process.env.REPLAY_TRACE === '1') console.log(`TRACE ${JSON.stringify(trace)}`);
    hooks.record?.(scenario, trace);
    if (hooks.failWhen?.(trace)) expect(trace, 'selected case fails on purpose').toBe('a failing observation');
  },
});
