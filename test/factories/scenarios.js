/**
 * fast-check arbitraries describing synthetic club nights. A "night script" is a
 * starting field plus a sequence of operator actions, replayed through the driver.
 */
import fc from 'fast-check';

/** One operator action during ranking rounds. */
export const nightOp = fc.oneof(
  { weight: 6, arbitrary: fc.constant({ op: 'round' }) },               // generate + play fully
  { weight: 1, arbitrary: fc.constant({ op: 'roundPartial' }) },        // generate, play only some
  { weight: 1, arbitrary: fc.record({ op: fc.constant('arrive'), n: fc.integer({ min: 1, max: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('leave'), pick: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('return'), pick: fc.nat() }) },
);

export const nightScript = fc.record({
  seed: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
  type: fc.constantFrom('monster', 'dyp'),
  players: fc.integer({ min: 4, max: 18 }),
  tables: fc.integer({ min: 1, max: 4 }),
  ops: fc.array(nightOp, { minLength: 1, maxLength: 9 }),
});

/**
 * Replay a night script. Calls `onRound(t, round, before)` right after each
 * round is generated, where `before` captures the state the draw saw.
 */
export function replayNight(app, d, script, onRound) {
  const ids = d.addPlayers(script.players);
  const t = d.createTournament({ type: script.type, tables: script.tables, format: 'swiss' });
  d.addToEvent(t, ids);
  const absent = () => new Set(t.absentIds || []);
  for (const step of script.ops) {
    d.open(t);
    if (step.op === 'arrive') {
      const extra = d.addPlayers(step.n);
      d.addToEvent(t, extra);
    } else if (step.op === 'leave') {
      const present = t.playerIds.filter((id) => !absent().has(id));
      if (present.length > 4) app.call('togglePlayerAbsent', present[step.pick % present.length]);
    } else if (step.op === 'return') {
      const gone = [...absent()];
      if (gone.length) app.call('togglePlayerAbsent', gone[step.pick % gone.length]);
    } else {
      const active = t.playerIds.filter((id) => !absent().has(id));
      if (active.length < 4) continue;
      const before = {
        rounds: JSON.parse(JSON.stringify(t.rounds)),
        active,
      };
      const r = d.generateRound(t);
      if (onRound) onRound(t, r, before);
      if (step.op === 'round') d.playRound(t);
      else {
        // interrupted round: score only the first match
        const m = r.matches[0];
        if (m) { const [a, b] = d.randomScore(5); d.scoreRanking(t, r.number, m.id, a, b); }
      }
    }
  }
  return t;
}

/** Long steady Monster nights: many rounds, few players — stresses the partner graph. */
export const longNight = fc.record({
  seed: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
  type: fc.constant('monster'),
  players: fc.integer({ min: 4, max: 13 }),
  tables: fc.integer({ min: 1, max: 3 }),
  ops: fc.integer({ min: 2, max: 10 }).map((n) => Array.from({ length: n }, () => ({ op: 'round' }))),
});
