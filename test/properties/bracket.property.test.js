/**
 * Property tests: single / double elimination brackets played with random
 * winners through the real score modal (no corrections — see
 * test/discrepancies/ for the correction paths).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { useApp } from '../harness/useApp.js';
import { fcParams } from '../harness/fcConfig.js';
import { sideIds } from '../factories/oracles.js';

const ctx = useApp();

const entKey = (e) => sideIds(e).slice().sort().join('+') || e?.id;
const isBye = (m) => m.scoreA === 0 && m.scoreB === 0;

/** Invariants that must hold at every moment of play. */
function checkLiveBracket(app, d, t) {
  const ready = d.readyBracketMatches(t);
  const seen = new Map();
  for (const m of ready) {
    const a = sideIds(m.a.entity); const b = sideIds(m.b.entity);
    expect(a.filter((x) => b.includes(x)), 'player on both sides of a match').toEqual([]);
    for (const id of [...a, ...b]) {
      expect(seen.has(id), `player ${id} in two ready matches`).toBe(false);
      seen.set(id, m.id);
    }
  }
  const live = d.bracketMatches(t).filter((m) => !m.winner && !m.onDeck && Number(m.table) >= 1 && app.call('isBracketMatchReady', m));
  const tables = live.map((m) => Number(m.table));
  expect(new Set(tables).size, 'two live bracket matches share a table').toBe(tables.length);
}

function lossCounts(d, t) {
  const losses = new Map();
  for (const m of d.bracketMatches(t)) {
    if (!m.winner || isBye(m) || !m.a?.entity || !m.b?.entity) continue;
    const loser = m.winner === 'a' ? m.b.entity : m.a.entity;
    losses.set(entKey(loser), (losses.get(entKey(loser)) || 0) + 1);
  }
  return losses;
}

const bracketCase = fc.record({
  seed: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
  n: fc.integer({ min: 3, max: 24 }),
  format: fc.constantFrom('single-elim', 'double-elim'),
  tables: fc.integer({ min: 1, max: 4 }),
});

describe('elimination brackets (singles, clean play)', () => {
  it('terminates with distinct 1st/2nd/3rd, never double-books, double-elim = 2 losses to exit', () => {
    fc.assert(fc.property(bracketCase, ({ seed, n, format, tables }) => {
      const { app } = ctx; app.reset({ seed });
      const d = ctx.d;
      const ids = d.addPlayers(n);
      const t = d.createTournament({ type: 'singles', format, tables });
      d.addToEvent(t, ids);
      d.startBracket(t);
      expect(t.playoffs, 'bracket created').toBeTruthy();

      let guard = 0;
      for (;;) {
        checkLiveBracket(app, d, t);
        const ready = d.readyBracketMatches(t);
        if (!ready.length) break;
        d.playBracketMatch(t, ready[0]);
        if (++guard > 4 * n + 10) throw new Error('bracket did not terminate');
      }

      const pl = t.placements || t.playoffs.placements;
      const places = [pl.first, pl.second, pl.third].map(entKey);
      places.forEach((p) => expect(p).toBeTruthy());
      expect(new Set(places).size).toBe(3);
      expect(t.status).toBe('finished');

      const losses = lossCounts(d, t);
      const champ = entKey(pl.first);
      expect(losses.get(champ) || 0).toBeLessThanOrEqual(format === 'double-elim' ? 1 : 0);
      for (const id of ids) {
        if (id === champ) continue;
        const l = losses.get(id) || 0;
        if (format === 'double-elim') expect(l, `player ${id} exited with ${l} losses`).toBe(2);
        else expect(l).toBeGreaterThanOrEqual(1);
      }
      expect(app.errors.map(String)).toEqual([]);
    }), fcParams(15));
  });

  it('[char] 2-entry double-elim is a single match (no grand final)', () => {
    const { d } = ctx;
    const ids = d.addPlayers(2);
    const t = d.createTournament({ type: 'singles', format: 'double-elim' });
    d.addToEvent(t, ids);
    d.startBracket(t);
    expect(d.playBracketToCompletion(t)).toBe(1);
    expect((t.placements || t.playoffs.placements).first).toBeTruthy();
  });
});
