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
