/**
 * Unit tests for small pure helpers in index.html.
 *
 * Labels used in this suite:
 *   [contract]  independently derived from README / domain rules (correctness)
 *   [char]      characterization: pins CURRENT behavior so refactors can't change it silently.
 *               A [char] test is not an endorsement — see docs/AUDIT.md for open questions.
 */
import { describe, it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';

const ctx = useApp();
const call = (name, ...a) => ctx.app.call(name, ...a);

describe('ranking helpers', () => {
  it('[contract] placement tiers follow README bands 1 · 2 · 3–4 · 5–8 · 9–16 · 17–32', () => {
    const tiers = [1, 2, 3, 4, 5, 8, 9, 16, 17, 32, 33, 100].map((p) => call('placementTierIndex', p));
    expect(tiers).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it('[contract] rank bands: Beginner <1000 … Master 5000+', () => {
    const label = (p) => call('rankingBandFromPoints', p).label;
    expect([0, 999, 1000, 1999, 2000, 2999, 3000, 4000, 4999, 5000].map(label)).toEqual(
      ['Beginner', 'Beginner', 'Rookie', 'Rookie', 'Amateur', 'Amateur', 'Expert', 'Pro', 'Pro', 'Master']);
    expect(label(null)).toBe('Amateur'); // start points
  });

  it('[contract] bonus shares always sum to the pool and follow the split', () => {
    for (let pool = 0; pool <= 500; pool++) {
      for (const fr of [[0.5, 0.3, 0.2], [0.6, 0.3, 0.1]]) {
        const s = call('splitBonusPoolShares', pool, ctx.app.toWindow(fr));
        expect(s[0] + s[1] + s[2]).toBe(pool);
        expect(s.every((x) => x >= 0)).toBe(true);
        expect(s[0]).toBeGreaterThanOrEqual(s[1]);
      }
    }
    expect([...call('splitBonusPoolShares', 160)]).toEqual([80, 48, 32]);
    expect([...call('splitBonusPoolShares', 160, ctx.app.toWindow([0.6, 0.3, 0.1]))]).toEqual([96, 48, 16]);
  });

  it('[contract] bonus split defaults to 50/30/20 and honours stored 60/30/10', () => {
    expect([...call('getBonusShareFractions')]).toEqual([0.5, 0.3, 0.2]);
    ctx.app.window.localStorage.setItem('lcfc_bonus_split_v1', '60-30-10');
    expect([...call('getBonusShareFractions')]).toEqual([0.6, 0.3, 0.1]);
    ctx.app.window.localStorage.setItem('lcfc_bonus_split_v1', 'garbage');
    expect(call('getBonusSplitMode')).toBe('50-30-20');
    ctx.app.window.localStorage.removeItem('lcfc_bonus_split_v1');
  });
});

describe('sit-out arithmetic', () => {
  it('[contract] ranking rounds sit only the remainder of 4 (README: tables do not cap play)', () => {
    const t = ctx.app.toWindow({ format: 'swiss', tables: 2 });
    const got = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17].map((n) => call('computeSitNeeded', t, n));
    expect(got).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 0, 1]);
  });

  it('[contract] elimination formats sit at most one (odd field)', () => {
    for (const format of ['single-elim', 'double-elim']) {
      const t = ctx.app.toWindow({ format, tables: 2 });
      expect([4, 5, 6, 7, 10, 11].map((n) => call('computeSitNeeded', t, n))).toEqual([0, 1, 0, 1, 0, 1]);
    }
  });

  it('[char] fewer than 4 players in ranking rounds: everyone sits', () => {
    const t = ctx.app.toWindow({ format: 'swiss' });
    expect([0, 1, 2, 3].map((n) => call('computeSitNeeded', t, n))).toEqual([0, 1, 2, 3]);
  });
});

describe('score validation (quickResultValid)', () => {
  const valid = (a, b, R, ot) => call('quickResultValid', a, b, R, ot);

  it('[contract] normal race: winner exactly R, loser 0..R-1', () => {
    expect(valid(5, 0, 5, false)).toBe(true);
    expect(valid(4, 5, 5, false)).toBe(true);
    expect(valid(5, 5, 5, false)).toBe(false);
    expect(valid(6, 4, 5, false)).toBe(false);
    expect(valid(4, 3, 5, false)).toBe(false);
    expect(valid(null, 3, 5, false)).toBe(false);
  });

  it('[char] OT with R=8: winner >= R and wins by 2 (R is forced to 8 under OT — see docs/AUDIT.md)', () => {
    expect(valid(8, 6, 8, true)).toBe(true);
    expect(valid(10, 8, 8, true)).toBe(true);
    expect(valid(8, 7, 8, true)).toBe(false);
    expect(valid(7, 5, 8, true)).toBe(false);
  });
});

describe('series helpers', () => {
  it('[contract] wins needed: Bo1→1, Bo3→2, Bo5→3', () => {
    expect([1, 3, 5].map((b) => call('seriesWinsNeeded', b))).toEqual([1, 2, 3]);
  });

  it('[contract] tally ignores incomplete/tied games and sums goals', () => {
    const games = ctx.app.toWindow([{ scoreA: 5, scoreB: 3 }, { scoreA: 2, scoreB: 5 }, { scoreA: 4, scoreB: 4 }, { scoreA: null, scoreB: 1 }, { scoreA: 5, scoreB: 0 }]);
    expect({ ...call('tallySeriesFromGames', games) }).toEqual({ seriesA: 2, seriesB: 1, gfA: 12, gfB: 8 });
  });

  it('[char] Monster playoffs are always best-of-3 regardless of event setting', () => {
    const t = ctx.app.toWindow({ type: 'monster', bestOf: 1 });
    expect(call('getTournamentBestOf', t, 'playoff')).toBe(3);
    expect(call('getTournamentBestOf', t, 'ranking')).toBe(1);
    const dyp = ctx.app.toWindow({ type: 'dyp', bestOf: 5 });
    expect(call('getTournamentBestOf', dyp, 'playoff')).toBe(5);
    expect(call('getTournamentBestOf', ctx.app.toWindow({ type: 'dyp', bestOf: 2 }), 'playoff')).toBe(1);
  });
});

describe('bracket seeding', () => {
  it('[contract] nextPowerOfTwo with 64-slot cap', () => {
    expect([1, 2, 3, 5, 8, 9, 33, 64, 65, 200].map((n) => call('nextPowerOfTwo', n))).toEqual([1, 2, 4, 8, 8, 16, 64, 64, 64, 64]);
  });

  it('[contract] standard seed placement: 1 v 8, 4 v 5, 2 v 7, 3 v 6', () => {
    const list = ctx.app.toWindow([1, 2, 3, 4, 5, 6, 7, 8].map((s) => ({ id: 'e' + s, name: 'E' + s, seed: s })));
    const pairs = call('arrangeFirstRoundSides', list, 8).map(([a, b]) => [a.seed, b.seed]);
    expect(pairs).toEqual([[1, 8], [4, 5], [2, 7], [3, 6]]);
  });

  it('[contract] byes go to top seeds and never face each other', () => {
    for (let n = 2; n <= 32; n++) {
      const size = call('nextPowerOfTwo', n);
      const list = ctx.app.toWindow(Array.from({ length: n }, (_, i) => ({ id: 'e' + (i + 1), name: 'E', seed: i + 1 })));
      const pairs = call('arrangeFirstRoundSides', list, size);
      const byes = pairs.filter(([a, b]) => !a.entity || !b.entity);
      expect(byes.length).toBe(size - n);
      expect(pairs.some(([a, b]) => !a.entity && !b.entity)).toBe(false);
      const byeSeeds = byes.map(([a, b]) => (a.entity ? a.seed : b.seed)).sort((x, y) => x - y);
      expect(byeSeeds).toEqual(Array.from({ length: size - n }, (_, i) => i + 1));
    }
  });
});

describe('misc', () => {
  it('[char] escapeHtml escapes & < > " but NOT single quote; non-strings throw', () => {
    expect(call('escapeHtml', `<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;\'&lt;/a&gt;');
    expect(call('escapeHtml', null)).toBe('');
    expect(() => call('escapeHtml', 42)).toThrow();
  });

  it('[contract] pairKey is order-independent', () => {
    expect(call('pairKey', 'b', 'a')).toBe(call('pairKey', 'a', 'b'));
  });

  it('[char] normalizePlayerState maps unknown codes to OTHER', () => {
    expect(['vt', ' NY ', 'zz', '', null].map((v) => call('normalizePlayerState', v))).toEqual(['VT', 'NY', 'OTHER', '', '']);
  });

  it('[char] entityPlayerIds resolves "A + B" names only when every part is a roster player', () => {
    ctx.app.setData({ players: [{ id: 'x1', name: 'Ann Mock' }, { id: 'x2', name: 'Bo Stub' }] });
    expect([...call('entityPlayerIds', ctx.app.toWindow({ id: 'team9', name: 'Ann Mock + Bo Stub' }))]).toEqual(['x1', 'x2']);
    expect([...call('entityPlayerIds', ctx.app.toWindow({ id: 'team9', name: 'Ann Mock + Nobody' }))]).toEqual([]);
    expect([...call('entityPlayerIds', ctx.app.toWindow({ id: 'x2', name: 'whatever' }))]).toEqual(['x2']);
  });
});
