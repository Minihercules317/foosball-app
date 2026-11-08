/** Self-test: the discrepancy helper must tell assertion failures from crashes. */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isAssertionFailure } from '../harness/discrepancy.js';

const thrown = (fn) => { try { fn(); } catch (e) { return e; } return null; };

describe('isAssertionFailure', () => {
  it('accepts a Vitest assertion failure', () => {
    expect(isAssertionFailure(thrown(() => expect(1).toBe(2)))).toBe(true);
  });
  it('accepts an assertion failure wrapped by fast-check', () => {
    const e = thrown(() => fc.assert(fc.property(fc.nat(), (n) => { expect(n).toBeLessThan(0); }), { numRuns: 5, seed: 1 }));
    expect(isAssertionFailure(e)).toBe(true);
  });
  it('rejects TypeErrors, plain errors and crashes inside fast-check', () => {
    expect(isAssertionFailure(thrown(() => null.x))).toBe(false);
    expect(isAssertionFailure(new Error('Test timed out in 5000ms'))).toBe(false);
    const e = thrown(() => fc.assert(fc.property(fc.nat(), () => { null.x; }), { numRuns: 5, seed: 1 }));
    expect(isAssertionFailure(e)).toBe(false);
  });
});
