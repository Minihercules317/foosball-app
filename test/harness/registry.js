/**
 * Every randomized property, by id — used by the replay entry point
 * (test/replay/replay.test.js) to re-run a single saved scenario.
 */
import { bracketClean } from '../properties/defs/bracket.js';
import { partnersRepeatFree } from '../properties/defs/partners.js';
import { roundStructure, steadySitSpread } from '../properties/defs/ranking-rounds.js';
import { disc01Correction, disc15Exploration } from '../discrepancies/defs.js';
import { replayDemo, replayDiscrepancyDemo } from '../selftest/replay-demo.js';

export const PROPERTIES = Object.fromEntries(
  [bracketClean, partnersRepeatFree, roundStructure, steadySitSpread, disc01Correction, disc15Exploration, replayDemo, replayDiscrepancyDemo]
    .map((def) => [def.id, def]),
);
