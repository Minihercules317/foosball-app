/**
 * Property test: Monster DYP partner rotation (definition in defs/partners.js).
 */
import { describe } from 'vitest';
import { propertyTest } from '../harness/scenario.js';
import { partnersRepeatFree } from './defs/partners.js';

describe('partner rotation (Monster DYP)', () => {
  propertyTest(partnersRepeatFree);
});
