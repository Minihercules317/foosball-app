/**
 * Named, TEST-ONLY fault injections. They exist to prove that the suite turns red
 * when the app misbehaves (self-tests in test/selftest/ run real test files with
 * a fault enabled and require them to FAIL). index.html on disk is never touched:
 * a fault only replaces a function inside one jsdom window, after boot.
 *
 * Enable with LCFC_FAULT=<name>[,<name>...]. With no LCFC_FAULT set, nothing happens.
 */
export const FAULTS = {
  /** submitScore does nothing (scores are silently dropped). */
  'noop-submitScore': (app) => { app.eval('submitScore = function () {}'); },
  /** Opening the Ranking stats tab crashes; every other tab works. */
  'throw-statsTab-ranking': (app) => {
    app.eval(`(function () {
      const orig = setStatsTab;
      setStatsTab = function (tab) {
        if (tab === 'ranking') throw new TypeError('injected fault: ranking tab crashed');
        return orig.apply(this, arguments);
      };
    })()`);
  },
  /** The player list renders nothing (a silently broken view). */
  'blank-renderPlayers': (app) => { app.eval('renderPlayers = function () {}'); },
  /**
   * Re-injects the v7.28 DISC-03 defect (resolved in v7.34): OPENING "Edit score" on a
   * finished best-of-3/5 match wipes its result in memory at once. The cleared fields are
   * copied from v7.28 openPlayoffScore / openScoreModal. Lets the classifier self-tests
   * use a known, deterministic discrepancy without depending on a live application bug.
   */
  'reintroduce-disc03-open-wipe': (app) => {
    app.eval(`(function () {
      const origPlayoff = openPlayoffScore;
      openPlayoffScore = function (matchId) {
        const t = getCurrentTournament();
        const match = t && findBracketMatch(t, matchId)?.match;
        const bestOf = t ? getTournamentBestOf(t, 'playoff') : 1;
        if (match && bestOf > 1 && match.winner && isSeriesComplete(match.seriesA || 0, match.seriesB || 0, bestOf)) {
          match.games = []; match.seriesA = 0; match.seriesB = 0;
          match.scoreA = null; match.scoreB = null; match.winner = null; match.loser = null;
        }
        return origPlayoff.apply(this, arguments);
      };
      const origRound = openScoreModal;
      openScoreModal = function (roundNum, matchId) {
        const t = getCurrentTournament();
        const round = t && t.rounds.find(r => r.number === parseInt(roundNum, 10));
        const match = round && round.matches.find(m => m.id === matchId);
        if (match && getTournamentBestOf(t, 'ranking') > 1 && match.status === 'done') {
          match.games = []; match.seriesA = 0; match.seriesB = 0;
          match.scoreA = null; match.scoreB = null; match.status = 'pending';
        }
        return origRound.apply(this, arguments);
      };
    })()`);
  },
};

export function activeFaults() {
  const raw = process.env.LCFC_FAULT || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function applyFaults(app) {
  for (const name of activeFaults()) {
    const fault = FAULTS[name];
    if (!fault) throw new Error(`LCFC_FAULT: unknown fault "${name}" (known: ${Object.keys(FAULTS).join(', ')})`);
    fault(app);
  }
}
