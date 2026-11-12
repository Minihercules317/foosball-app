/**
 * Fault-injection probes — run ONLY in a child Vitest process by
 * test/selftest/classifier.test.js ("fault injection … (child process)").
 *
 * The two DISC-03 scenarios that were real discrepancies up to v7.32 (their scenario and
 * checkpoint are copied from the former test/discrepancies tests, now
 * test/regression/resolved-discrepancies.test.js). v7.34 fixed DISC-03, so the self-test
 * re-injects the v7.28 defect with LCFC_FAULT=reintroduce-disc03-open-wipe; each probe is then
 * a known discrepancy that reproduces deterministically. Adding LCFC_FAULT=noop-submitScore
 * breaks scoring in setup: every probe must then fail as UNEXPECTED, never as the known finding.
 */
import { expect } from 'vitest';
import { useApp } from '../../harness/useApp.js';
import { discrepancy } from '../../harness/discrepancy.js';

const ctx = useApp();

discrepancy('PROBE-DISC-03', 'Monster playoff (Bo3): open edit modal on a finished match, cancel → winner unchanged',
  { checkpoint: 'winner-after-cancel' }, (disc) => {
    const { d, app } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster', tables: 2 });
    d.addToEvent(t, ids);
    for (let i = 0; i < 2; i++) { d.generateRound(t); d.playRound(t); }
    d.startPlayoffs(t);
    const m = d.readyBracketMatches(t)[0];
    expect(m, 'setup: a ready playoff match').toBeTruthy();
    d.playBracketMatch(t, m, true);
    expect(m.winner, 'setup: the playoff match was won by side a').toBe('a');
    app.call('openPlayoffScore', m.id);
    app.call('closeScoreModal');
    disc.observe('winner-after-cancel', () => expect(m.winner).toBe('a'));
  });

discrepancy('PROBE-DISC-03', 'Bo3 ranking round: open edit modal on a finished series, cancel → result unchanged',
  { checkpoint: 'series-after-cancel' }, (disc) => {
    const { d, app } = ctx;
    const ids = d.addPlayers(8);
    const t = d.createTournament({ type: 'monster', tables: 2, bestOf: 3 });
    d.addToEvent(t, ids);
    const r = d.generateRound(t);
    d.playRound(t);
    const m = r.matches[0];
    expect(m.status, 'setup: the series was completed').toBe('done');
    const before = { status: m.status, scoreA: m.scoreA, scoreB: m.scoreB, games: m.games.length };
    d.open(t);
    app.call('openScoreModal', r.number, m.id);
    app.call('closeScoreModal');
    disc.observe('series-after-cancel', () => {
      expect({ status: m.status, scoreA: m.scoreA, scoreB: m.scoreB, games: m.games.length }).toEqual(before);
    });
  });
