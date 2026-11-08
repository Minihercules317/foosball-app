/**
 * Property tests: elimination brackets (definition in defs/bracket.js).
 */
import { describe, it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { propertyTest } from '../harness/scenario.js';
import { bracketClean } from './defs/bracket.js';

const ctx = useApp();

describe('elimination brackets (singles, clean play)', () => {
  propertyTest(bracketClean);

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
