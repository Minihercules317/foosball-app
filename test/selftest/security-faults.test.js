/**
 * SELF-TEST (review F4): the display-name security test fails when a view crashes
 * or silently renders nothing — exceptions are no longer swallowed, and each view
 * must positively show the names. Runs the REAL test file in a child process
 * with a named fault (LCFC_FAULT, test/harness/faults.js), plus a clean control.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runVitest } from './nested.js';

describe('fault injection into the real security test (child process)', () => {
  const runs = {};
  beforeAll(async () => {
    const security = { files: ['test/integration/security.test.js'] };
    [runs.secRanking, runs.secPlayers, runs.secClean] = await Promise.all([
      runVitest({ ...security, env: { LCFC_FAULT: 'throw-statsTab-ranking' } }),
      runVitest({ ...security, env: { LCFC_FAULT: 'blank-renderPlayers' } }),
      runVitest(security),
    ]);
  }, 180_000);

  const ran = (r) => [...r.tests.values()].filter((t) => t.status !== 'skipped');

  it('fails when the Ranking stats tab crashes (the review\'s probe: setStatsTab("ranking") throws)', () => {
    const [t] = ran(runs.secRanking);
    expect(t.status).toBe('failed');
    expect(t.message).toContain('injected fault: ranking tab crashed');
  });
  it('fails when a view silently renders nothing (positive content check)', () => {
    const [t] = ran(runs.secPlayers);
    expect(t.status).toBe('failed');
    expect(t.message).toContain('players list: rendered');
  });
  it('positive control: passes without a fault', () => {
    const [t] = ran(runs.secClean);
    expect(t.status, t.message).toBe('passed');
  });
});
