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
  /**
   * Re-injects the v7.37 Monster draw (DISC-15, not reproduced by v7.42): the v7.37
   * pickFairSitOuts, buildOnePairing and fairPairPlayers, copied VERBATIM from index.html at
   * 3cff231 (upstream 72ce308). v7.42 changed all three (consecutive-partner rules, exact
   * search for small fields, sit-out ring); generateRound and its call sites are unchanged,
   * so with this fault a seeded night replays exactly as it did on v7.37. Lets the stress
   * self-test exercise a real known-discrepancy finding without a live application bug.
   */
  'reintroduce-disc15-v737-draw': (app) => {
    app.eval(`(function () {
      pickFairSitOuts = function pickFairSitOuts(t, players, needed) {
        if (needed <= 0 || !players.length) return [];
        needed = Math.min(needed, players.length);
        const counts = getSitOutCounts(t);
        const played = getRankingPlayedCounts(t);
        const lastSit = new Set();
        const lastRound = (t.rounds || [])[(t.rounds || []).length - 1];
        if (lastRound && lastRound.sitOutIds && lastRound.sitOutIds.length) {
          lastRound.sitOutIds.forEach(id => lastSit.add(id));
        }
        // Only active players stay in the rotation ring (absent / removed drop out)
        const activeIds = new Set(players.map(p => p.id));
        if (!Array.isArray(t.sitOutQueue)) t.sitOutQueue = [];
        t.sitOutQueue = t.sitOutQueue.filter(id => activeIds.has(id));
        const queueIds = t.sitOutQueue.slice();

        const remaining = players.slice();
        const chosen = [];

        const pickOneFrom = (pool) => {
          if (!pool.length) return null;
          const minC = Math.min.apply(null, pool.map(p => counts[p.id] || 0));
          let tier = pool.filter(p => (counts[p.id] || 0) === minC);
          // Among equal sits: prefer players who have played more ranking matches
          // (late joiners with 0 sits and 1 game played sit after long-time 0-sit players)
          const maxPlayed = Math.max.apply(null, tier.map(p => played[p.id] || 0));
          const highPlayed = tier.filter(p => (played[p.id] || 0) === maxPlayed);
          if (highPlayed.length) tier = highPlayed;
          // Avoid back-to-back sits when possible
          const notLast = tier.filter(p => !lastSit.has(p.id));
          if (notLast.length) tier = notLast;
          // Ring order: earlier in queue sits first
          tier.sort((a, b) => {
            const ia = queueIds.indexOf(a.id);
            const ib = queueIds.indexOf(b.id);
            const ra = ia < 0 ? 9999 : ia;
            const rb = ib < 0 ? 9999 : ib;
            if (ra !== rb) return ra - rb;
            return Math.random() - 0.5;
          });
          return tier[0] || null;
        };

        // 1) Veterans (played ≥1 ranking match) fill sit slots first
        // 2) Rookies (never played — e.g. just added) only sit if still short of needed
        while (chosen.length < needed && remaining.length) {
          const veterans = remaining.filter(p => (played[p.id] || 0) > 0);
          const rookies = remaining.filter(p => (played[p.id] || 0) === 0);
          const pool = veterans.length ? veterans : rookies;
          const pick = pickOneFrom(pool);
          if (!pick) break;
          chosen.push(pick);
          const idx = remaining.findIndex(p => p.id === pick.id);
          if (idx >= 0) remaining.splice(idx, 1);
        }

        const chosenIds = chosen.map(p => p.id);
        const restQ = queueIds.filter(id => !chosenIds.includes(id) && activeIds.has(id));
        const notInQueue = players.map(p => p.id).filter(id => !restQ.includes(id) && !chosenIds.includes(id));
        // Rotate: unchosen keep order, new active players, then those who just sat
        t.sitOutQueue = restQ.concat(notInQueue).concat(chosenIds);
        return chosen;
      };
      buildOnePairing = function buildOnePairing(t, active, counts, byPlayer) {
        const remaining = [...active];
        const pairs = [];
        const used = new Set();

        const newPartnerCount = (p) => {
          let n = 0;
          for (const o of remaining) {
            if (o.id === p.id || used.has(o.id)) continue;
            if ((counts[pairKey(p.id, o.id)] || 0) === 0) n++;
          }
          return n;
        };

        // Hardest-to-match first (fewest unused partners), shuffle within ties
        const order = shuffle([...remaining]).sort((a, b) => newPartnerCount(a) - newPartnerCount(b));

        for (const p of order) {
          if (used.has(p.id)) continue;
          let candidates = remaining.filter(o => o.id !== p.id && !used.has(o.id));
          let pool = candidates.filter(o => (counts[pairKey(p.id, o.id)] || 0) === 0);
          if (!pool.length) {
            pool = candidates.filter(o => isPartnerAllowed(t, counts, byPlayer, p.id, o.id));
          }
          if (!pool.length) pool = candidates;
          if (!pool.length) continue;
          shuffle(pool);
          pool.sort((a, b) => {
            const ca = counts[pairKey(p.id, a.id)] || 0;
            const cb = counts[pairKey(p.id, b.id)] || 0;
            if (ca !== cb) return ca - cb;
            return newPartnerCount(a) - newPartnerCount(b);
          });
          const partner = pool[0];
          pairs.push([p, partner]);
          used.add(p.id);
          used.add(partner.id);
        }
        return pairs;
      };
      fairPairPlayers = function fairPairPlayers(t, active) {
        if (active.length < 2) return [];
        const { counts, byPlayer } = getPartnershipData(t);
        let best = null;
        let bestMetric = { forbidden: Infinity, rematches: Infinity, score: Infinity };
        // More trials for denser fields so "no rematch until full cycle" is realistic
        const trials = Math.min(400, 40 + active.length * 20);
        let zeroForbiddenFound = false;

        for (let i = 0; i < trials; i++) {
          const pairs = buildOnePairing(t, active, counts, byPlayer);
          if (pairs.length < Math.floor(active.length / 2)) continue;
          let forbidden = 0;
          pairs.forEach(([a, b]) => {
            if (!isPartnerAllowed(t, counts, byPlayer, a.id, b.id)) forbidden++;
          });
          if (forbidden === 0) zeroForbiddenFound = true;
          // Hard rule: once a zero-forbidden pairing exists, never accept rematches
          if (zeroForbiddenFound && forbidden > 0) continue;
          const metric = scorePairing(pairs, counts);
          metric.forbidden = forbidden;
          if (
            forbidden < bestMetric.forbidden ||
            (forbidden === bestMetric.forbidden && metric.rematches < bestMetric.rematches) ||
            (forbidden === bestMetric.forbidden && metric.rematches === bestMetric.rematches && metric.score < bestMetric.score)
          ) {
            bestMetric = metric;
            best = pairs;
            if (forbidden === 0 && metric.rematches === 0) break;
          }
        }

        if (best) return best;

        // Absolute fallback
        const ordered = shuffle([...active]);
        const pairs = [];
        for (let i = 0; i < ordered.length - 1; i += 2) {
          pairs.push([ordered[i], ordered[i + 1]]);
        }
        return pairs;
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
