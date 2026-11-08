/**
 * Property tests: Monster DYP / DYP ranking rounds (definitions in defs/ranking-rounds.js).
 * Each generated night runs in its own fresh window (test/harness/scenario.js).
 * A failure prints the fast-check seed/path and writes a replayable scenario
 * fixture under test-results/scenarios/ (see docs/TESTING.md).
 */
import { describe } from 'vitest';
import { propertyTest } from '../harness/scenario.js';
import { roundStructure, steadySitSpread } from './defs/ranking-rounds.js';

describe('ranking rounds (Monster / DYP)', () => {
  propertyTest(roundStructure);
  propertyTest(steadySitSpread);
});
