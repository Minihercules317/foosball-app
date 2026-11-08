/**
 * DISCREPANCY — finish places outside the podium (AUDIT DISC-16). Rules question
 * for the owner. Found while repairing the non-podium regression guard (review F7).
 *
 * getEventFinishPlaces orders non-podium entries by "fewer bracket losses first"
 * (comment: "fewer bracket losses = deeper run"). In double elimination every
 * non-podium entry has 2 losses, so the key never matters there. In SINGLE
 * elimination with a bronze match, the bronze loser — a semi-finalist — has 2
 * losses and quarter-final losers have 1, so the deepest non-podium run is ranked
 * LAST (8th of 8). This feeds ranking seed points (tiers 3–4 vs 5–8).
 */
import { describe, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { discrepancy } from '../harness/discrepancy.js';
import { bronzeLoserScenario } from './defs.js';

const ctx = useApp();

describe('DISC-16 non-podium places reflect how deep a player went', () => {
  discrepancy('DISC-16', 'single-elim 8 with bronze match: the bronze-match loser (a semi-finalist) places 4th, ahead of quarter-final losers',
    { checkpoint: 'bronze-loser-fourth' }, (disc) => {
      const { bronzeLoser, qfLosers, placeOf, t } = bronzeLoserScenario(ctx.app, ctx.d);
      expect(t.rankingDeltaDetail[bronzeLoser]?.place, 'setup: ranking uses the same places').toBe(placeOf[bronzeLoser]);
      disc.observe('bronze-loser-fourth', () => {
        expect(placeOf[bronzeLoser], `bronze loser placed ${placeOf[bronzeLoser]}; QF losers ${qfLosers.map((id) => placeOf[id])}`).toBe(4);
      });
    });
});
