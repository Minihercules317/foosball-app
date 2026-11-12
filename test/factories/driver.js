/**
 * Driver: runs tournament flows through the PRODUCTION functions in index.html
 * (saveTournament, generateRound, openScoreModal/submitScore, startPlayoffs, ...),
 * filling the same DOM inputs an operator would. This keeps tests honest: they
 * exercise the shipped code paths, not re-implementations.
 */
import { makeRng } from './random.js';
import { makePlayers } from './players.js';

export function createDriver(app, { seed = 1 } = {}) {
  const w = app.window;
  const doc = w.document;
  const rng = makeRng(seed);
  const $ = (id) => doc.getElementById(id);

  const d = {
    rng,
    get state() { return app.state; },

    /** Add fabricated players to the club roster (same shape savePlayer() creates). */
    addPlayers(n, opts = {}) {
      const ps = makePlayers(n, { seed: opts.seed ?? rng.int(1, 1e9), ...opts });
      for (const p of ps) app.state.players.push(app.toWindow(p));
      app.call('saveState');
      return ps.map((p) => p.id);
    },

    player: (id) => app.state.players.find((p) => p.id === id),

    /** Create a tournament through the real create form + saveTournament(). */
    createTournament({
      type = 'monster', format = 'swiss', raceTo = 5, bestOf = 1, tables = 2,
      sandbox = false, drawStyle = 'random', name = 'Synthetic Night', monsterPositions = false,
    } = {}) {
      app.call('startCreateTournament');
      $('t-name').value = name;
      $('t-format').value = format;
      $('t-race').value = String(raceTo);
      $('t-bestof').value = String(bestOf);
      $('t-tables').value = String(tables);
      const sb = $('t-sandbox'); if (sb) sb.checked = sandbox;
      const btn = doc.querySelector(`.type-btn[data-type="${type}"]`);
      if (!btn) throw new Error(`no type button for ${type}`);
      app.call('selectType', btn);
      const pos = $('t-monster-positions'); if (pos) pos.checked = monsterPositions;
      const radio = doc.querySelector(`input[name="draw-style"][value="${drawStyle}"]`);
      if (radio) radio.checked = true;
      app.call('saveTournament');
      const t = app.state.tournaments[0];
      if (t.type !== type) throw new Error('tournament not created');
      return t;
    },

    open(t) { app.call('openTournament', t.id); return t; },

    /** Add roster players to the current event via the real checkbox flow. */
    addToEvent(t, ids) {
      d.open(t);
      app.call('updateAddPlayerSelect', t);
      const boxes = [...doc.querySelectorAll('#add-player-roster input.add-player-cb')];
      const want = new Set(ids);
      boxes.forEach((cb) => { cb.checked = want.has(cb.value); });
      app.call('addSelectedPlayersToTournament');
      return t;
    },

    /** Doubles: form fixed teams directly in the same shape formTeam() produces. */
    formTeams(t, ids) {
      for (let i = 0; i + 1 < ids.length; i += 2) {
        const a = d.player(ids[i]); const b = d.player(ids[i + 1]);
        t.teams.push(app.toWindow({ id: `team_${ids[i]}_${ids[i + 1]}`, playerIds: [a.id, b.id], name: `${a.name} + ${b.name}` }));
      }
      app.call('saveState');
    },

    generateRound(t) { d.open(t); app.call('generateRound'); return t.rounds[t.rounds.length - 1]; },

    lastRound: (t) => t.rounds[t.rounds.length - 1],

    setOvertime(on) { const ot = $('score-overtime'); if (ot) ot.checked = !!on; },

    /**
     * Enter one game score for a ranking-round match through the score modal.
     * Returns the toasts emitted so callers can detect rejections.
     */
    scoreRanking(t, roundNum, matchId, a, b, { ot = false } = {}) {
      d.open(t);
      app.call('openScoreModal', roundNum, matchId);
      d.setOvertime(ot);
      $('score-a').value = String(a);
      $('score-b').value = String(b);
      app.call('submitScore');
      return app.toasts();
    },

    /** Enter one game score for a bracket/playoff match through the score modal. */
    scoreBracket(t, matchId, a, b, { ot = false } = {}) {
      d.open(t);
      app.call('openPlayoffScore', matchId);
      d.setOvertime(ot);
      $('score-a').value = String(a);
      $('score-b').value = String(b);
      app.call('submitScore');
      return app.toasts();
    },

    /** A random valid race-to score (no OT) where `aWins` decides the winner. */
    randomScore(raceTo, aWins = rng.bool()) {
      const lo = rng.int(0, raceTo - 1);
      return aWins ? [raceTo, lo] : [lo, raceTo];
    },

    /** Score every unfinished match of the latest round (best-of aware). */
    playRound(t, { raceTo = Number(t.raceTo) || 5 } = {}) {
      const r = d.lastRound(t);
      const bestOf = app.call('getTournamentBestOf', t, 'ranking');
      const need = Math.ceil(bestOf / 2);
      for (const m of r.matches) {
        if (m.status === 'done') continue;
        const aWins = rng.bool();
        // Series: winner takes `need` games; loser takes a random number < need.
        const loserGames = rng.int(0, need - 1);
        // Winner must take the final game, so shuffle the rest and append it.
        const before = [...Array(need - 1).fill(aWins), ...Array(loserGames).fill(!aWins)];
        const games = rng.shuffle(before).concat([aWins]);
        for (const g of games) {
          const [a, b] = d.randomScore(raceTo, g);
          d.scoreRanking(t, r.number, m.id, a, b);
        }
      }
      return r;
    },

    startPlayoffs(t) { d.open(t); app.call('startPlayoffs'); return t.playoffs; },
    startBracket(t) { d.open(t); app.call('startBracketTournament'); return t.playoffs; },

    bracketMatches: (t) => [...app.call('collectBracketMatches', t.playoffs)],

    /** Ready = both sides known, no winner yet (production predicate). */
    readyBracketMatches: (t) => d.bracketMatches(t).filter((m) =>
      !m.winner && !m.void && m.a?.entity && m.b?.entity && app.call('isBracketMatchReady', m)),

    /** Play one bracket match to completion (best-of aware). Returns 'a'|'b'. */
    playBracketMatch(t, m, aWins = rng.bool(), { raceTo = Number(t.raceTo) || 5 } = {}) {
      const bestOf = app.call('getTournamentBestOf', t, 'playoff');
      const need = Math.ceil(bestOf / 2);
      for (let i = 0; i < need; i++) {
        const [a, b] = d.randomScore(raceTo, aWins);
        d.scoreBracket(t, m.id, a, b);
      }
      return aWins ? 'a' : 'b';
    },

    /**
     * Run exportAllData() and return the payload. downloadJson is replaced in
     * the test window only (jsdom has no URL.createObjectURL / downloads).
     */
    exportAll() {
      let captured = null;
      w.__captureDownload = (filename, data) => { captured = { filename, data: JSON.parse(JSON.stringify(data)) }; };
      w.eval('downloadJson = function (f, d) { window.__captureDownload(f, d); }');
      app.call('exportAllData');
      return captured;
    },

    exportTournament(t) {
      let captured = null;
      w.__captureDownload = (filename, data) => { captured = { filename, data: JSON.parse(JSON.stringify(data)) }; };
      w.eval('downloadJson = function (f, d) { window.__captureDownload(f, d); }');
      d.open(t);
      app.call('exportTournamentJson');
      return captured;
    },

    /**
     * Import a JSON payload through the real file-input handler.
     * @param {object} payload
     * @param {boolean[]} confirms answers for the confirm() dialogs in order
     */
    async importJson(payload, confirms = []) {
      app.dialogs.confirm.push(...confirms);
      const file = new w.File([JSON.stringify(payload)], 'import.json', { type: 'application/json' });
      app.call('importDataFromFile', { target: { files: [file], value: '' } });
      for (let i = 0; i < 20; i++) await new Promise((r) => w.setTimeout(r, 0)); // FileReader is async
      return app.toasts();
    },

    /** Simulate the 5-second auto-refresh tick (it reloads from localStorage). */
    tick() { app.call('tickAppAutoRefresh'); },

    /** Play the whole bracket with random winners; guards against infinite loops. */
    playBracketToCompletion(t, { maxMatches = 500, pickWinner } = {}) {
      let n = 0;
      for (;;) {
        const ready = d.readyBracketMatches(t);
        if (!ready.length) break;
        const m = ready[0];
        d.playBracketMatch(t, m, pickWinner ? pickWinner(m) : rng.bool());
        // Fail fast (and clearly) if scoring did not record a result, instead of
        // spinning until maxMatches: a played match must have a winner.
        const after = d.bracketMatches(t).find((x) => x.id === m.id);
        if (!after?.winner) throw new Error(`driver: bracket match ${m.id} has no winner after being played — scoring did not record the result`);
        if (++n > maxMatches) throw new Error('bracket did not terminate');
      }
      return n;
    },
  };
  return d;
}

/**
 * Convenience: a full Monster DYP night (players → ranking rounds → playoffs → champion).
 */
export function runMonsterNight(app, d, { players = 8, rounds = 3, tables = 2, sandbox = false, name } = {}) {
  const ids = d.addPlayers(players);
  const t = d.createTournament({ type: 'monster', tables, sandbox, name });
  d.addToEvent(t, ids);
  for (let i = 0; i < rounds; i++) { d.generateRound(t); d.playRound(t); }
  d.startPlayoffs(t);
  d.playBracketToCompletion(t);
  return { t, ids };
}

/**
 * Recorded club history for the 8 players (p_0001 … p_0008) of a bracket-only team event.
 *
 * Owner-confirmed ranking model (2026-11-11): every player starts at 2,000 club points and
 * points are derived ONLY from recorded tournament results (manual "Recalculate" resets
 * everyone to 2,000 and replays events chronologically). A starting state with hand-set
 * balances is therefore not a state the club can be in; the team-seed checks instead give
 * the field distinct points by PLAYING earlier events through the production code.
 *
 * Four fabricated earlier Singles brackets (single elimination). Each entry lists player
 * numbers in "strength order": in every match the player listed earlier wins.
 */
export const TEAM_EVENT_HISTORY = [
  [2, 7, 4, 8, 6],
  [3, 8, 1, 2, 6],
  [3, 6, 7, 2],
  [5, 7, 4, 8, 2, 1],
];
/** Recorded (fabricated) dates of the history events, so chronological replay order is explicit. */
export const TEAM_EVENT_HISTORY_DATES = [Date.UTC(2026, 0, 6, 23), Date.UTC(2026, 0, 13, 23), Date.UTC(2026, 0, 20, 23), Date.UTC(2026, 0, 27, 23)];

/**
 * Club points TEAM_EVENT_HISTORY produces (2,000 + each player's recorded deltas). Pinned so
 * the team-event expectations can be derived by hand; test/regression/checks.js asserts that
 * the history really produces them (and that "Recalculate" reproduces them) rather than
 * assuming it. Every pair of players has a DIFFERENT sum, so whatever teams are formed or
 * drawn, "team strength" (sum of partner points) is never tied.
 * Total 16,404 → bonus pool 1% = 164.
 */
export const TEAM_EVENT_POINTS = [2020, 2026, 2108, 2038, 2085, 2000, 2077, 2050];

/**
 * Play TEAM_EVENT_HISTORY for `ids` (one finished, ranked Singles bracket per entry).
 * Returns the history events, oldest first.
 */
export function playRankingHistory(app, d, ids, history = TEAM_EVENT_HISTORY) {
  return history.map((order, k) => {
    const field = order.map((n) => ids[n - 1]);
    const t = d.createTournament({ type: 'singles', format: 'single-elim', name: `Synthetic Singles ${k + 1}` });
    t.createdAt = TEAM_EVENT_HISTORY_DATES[k];
    d.addToEvent(t, field);
    d.startBracket(t);
    const strength = (e) => field.indexOf((e?.playerIds && e.playerIds[0]) || e?.id);
    d.playBracketToCompletion(t, { pickWinner: (m) => strength(m.a.entity) < strength(m.b.entity) });
    return t;
  });
}

/**
 * Convenience: a bracket-only TEAM event (no ranking rounds) of 4 teams with a scripted
 * result, played after the recorded TEAM_EVENT_HISTORY. Doubles uses fixed teams (p1+p2,
 * p3+p4, p5+p6, p7+p8); DYP / Monster draw their teams inside startBracketTournament().
 * `upset: true` → the team with the HIGHER seed number wins every match; `false` → the lower
 * seed number wins every match ("chalk").
 * Returns the event, each team's bracket seed as stored on the bracket sides, the history
 * events and every player's club points right before the event.
 *
 * `legacyStartPoints` exists ONLY so scripts/generate-fixtures.mjs can regenerate the
 * committed v7.28 fixture exactly as it was made (hand-set balances instead of a history).
 * Hand-set balances are not a valid state under the owner-confirmed ranking model and are
 * erased by v7.34's automatic ranking rebuild (DISC-17); do not use them in tests.
 */
export function runBracketOnlyTeamEvent(app, d, { type = 'doubles', format = 'double-elim', upset = true, name, legacyStartPoints } = {}) {
  const ids = d.addPlayers(8);
  let history = [];
  if (legacyStartPoints) ids.forEach((id, i) => { d.player(id).rankingPoints = legacyStartPoints[i]; });
  else history = playRankingHistory(app, d, ids);
  const pointsBefore = Object.fromEntries(ids.map((id) => [id, d.player(id).rankingPoints]));
  app.call('saveState');
  const t = d.createTournament({ type, format, name });
  d.addToEvent(t, ids);
  if (type === 'doubles') d.formTeams(t, ids);
  d.startBracket(t);
  const teamKey = (ent) => (ent?.playerIds || []).slice().sort().join('+');
  const seedOf = new Map();
  for (const m of d.bracketMatches(t)) {
    for (const side of [m.a, m.b]) {
      const seed = Number(side?.seed ?? side?.entity?.seed);
      if (side?.entity && seed > 0) seedOf.set(teamKey(side.entity), seed);
    }
  }
  d.playBracketToCompletion(t, {
    pickWinner: (m) => {
      const a = seedOf.get(teamKey(m.a.entity)); const b = seedOf.get(teamKey(m.b.entity));
      if (!(a > 0) || !(b > 0)) throw new Error(`driver: no bracket seed for a side of match ${m.id}`);
      return upset ? a > b : a < b;
    },
  });
  return { t, ids, seedOf, teamKey, history, pointsBefore };
}
