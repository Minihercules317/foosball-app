# LCFC Manager — Current Behavior & Data Flow (baseline, v7.28)

This document records **how the application behaves today**. It is the compatibility
baseline for refactoring. It is descriptive, not a judgment: where behavior looks
surprising it is noted for review in [AUDIT.md](AUDIT.md), not "corrected" here.

Line numbers refer to `index.html` at v7.28 (commit `71c4a58` on upstream `main`).

## 1. Shape of the application

| Aspect | Today |
|---|---|
| Delivery | One static file, `index.html` (~15.5k lines). Three inline `<script>` blocks: theme bootstrap (l.14), Tailwind config (l.190), the app (l.3582–15479). |
| External runtime deps | `cdn.tailwindcss.com` (unpinned Play CDN), `chart.js@4.4.1` (pinned) |
| Code organisation | ~500 top-level functions sharing one mutable global `state` object; HTML built with template strings + `innerHTML`; handlers via inline `onclick="fn('id')"` |
| Persistence | `localStorage['foosmanager_v1']` = `{players, tournaments}` (whole blob, rewritten on every save) |
| Distribution | Operator exports a full backup → uploads it to the repo as `data/latest.json` → GitHub Pages serves it to members |
| Usage profile (from the production snapshot, aggregate only) | 13 events: 12 Monster DYP (Swiss ranking rounds → playoffs), 1 DYP double-elim; 8–16 players; 2–3 tables; race to 5; Bo1 ranking / Bo3 playoffs; "absent" status used in 11 of 13 events |

## 2. Data model (as stored)

```
players[]:     { id, name, skill(1–6), rankingPoints, rankingDelta, region, homeState, avatarData? }
tournaments[]: {
  id, name, type: singles|doubles|dyp|monster, format: swiss|roundrobin|single-elim|double-elim,
  raceTo, bestOf(1|3|5), tables, drawStyle: random|highlow, monsterPositions, sandbox, colorBand,
  status: setup|active|finished, createdAt (= editable event date, drives ranking order),
  playerIds[], absentIds[], teams[] (current draw), currentRound, currentSitOutIds[], sitOutQueue[],
  rounds[]: { number, sitOutIds[], teams[], matches[]: {
      id, entityA, entityB, scoreA, scoreB, games[{scoreA,scoreB}], seriesA, seriesB,
      status: pending|done, table, onDeck, coinToss, timer fields, crossConflict fields } },
  playoffTeams[]: { id, playerIds, name, seed, tieredFrom },
  playoffs: { type, size, winnersRounds[], losersRounds[], grandFinal, grandFinal2, bronze,
              placements{first,second,third}, gfResetRequired, bonusPoolLocked, bestOf, ... },
  placements, bonusPoolLocked{fieldIds, fieldPoints, bonusPool, shares, fr, mode, lockedAt},
  rankingApplied, rankingAppliedAt, rankingDeltas{playerId:Δ}, rankingDeltaDetail, rankingBonusShare, rankingBonusPool
}
```

Entities on a match side are `{id, name, type:'player'|'team', playerIds?, seed?}`. Many
functions fall back to resolving players from a `"Name + Name"` label when ids are missing
(legacy data), see `entityPlayerIds` (l.10688).

## 3. Lifecycles

### Monster DYP night (the dominant workflow)
1. **Create** (`saveTournament` l.5018) → status `setup`.
2. **Add players** (`addSelectedPlayersToTournament` l.5795). Adding during a night clears the
   pending team draw but keeps sit-out history.
3. **Generate round** (`generateRound` l.7186), each round:
   - `drawPartners({force:true})` → `computeSitNeeded` = *active count mod 4* (tables never cap
     play; extra matches queue "on deck").
   - `pickFairSitOuts` (l.6770) priority: (1) veterans (≥1 ranking match played) before brand-new
     arrivals, (2) fewest sit-outs so far, (3) most matches played, (4) not sat last round,
     (5) rotating `sitOutQueue`, (6) random.
   - `fairPairPlayers` (l.6944): up to 120 randomized greedy trials; prefers never-paired
     partners; a repeat is "allowed" only once both players have partnered every other
     active player.
   - `pairRankingEntities` (l.7149): opponents chosen by standings order, avoiding prior
     opponents; first `tables` matches get tables 1..N, the rest are on deck.
4. **Score** (`openScoreModal` → `submitScore` l.9291). Validation: no draws; winner exactly
   `raceTo`, loser below it; with the per-match **OT** box ticked the target becomes a fixed 8
   with win-by-2. Bo3/Bo5 append games until a side has the needed wins.
5. **Absent** (`togglePlayerAbsent` l.6463): player keeps history, is skipped in draws/playoffs.
6. **Playoffs** (`startPlayoffs` l.7936): `buildTieredPlayoffTeams` pairs standings rank *i*
   with rank *i + n/2* (odd field: lowest eligible sits out) → seeded double-elimination,
   always best-of-3 for Monster; bonus pool locked (`lockBonusPoolSnapshot`).
7. **Bracket** (`submitBracketScore` l.9359 → `propagateBracketResult` l.9676): winner/loser
   feeds, byes auto-advance, grand-final reset (`grandFinal2`) if the losers-bracket side wins.
8. **Finish**: when 1st and 2nd are known, `updatePlacementsFromBracket` → `tryApplyRankingOnFinish`
   sets status `finished` and applies club ranking **once** (`rankingApplied`).

Other types: **Singles** (players are entities; bracket-only events seeded by club ranking),
**Doubles** (fixed teams formed manually), **DYP** (random partners; ranking rounds or bracket).

### Club ranking (l.4061–4553)
- Start 2000. Changes **only** from finished bracket/playoff events; sandbox events excluded.
- Per place-group Δ = `(tier(expected) − tier(actual)) × 8` + podium bonus. Tiers: 1 · 2 · 3–4 ·
  5–8 · 9–16 · 17–32 · 33+. Expected place = playoff team seed (else pre-event points order).
- Bonus pool = 1% of the playoff field's points, locked at playoff creation; split 50/30/20 or
  60/30/10 (stored per device); shares always sum to the pool. Partners share the same Δ.
- Non-podium places: fewer bracket losses first, then ranking-round standing, then name.
- **Recalculate** resets all players to 2000 and replays events ordered by `createdAt`.
- **Import/snapshot load** keeps per-event `rankingDeltas` from the file and rebuilds player
  totals from them (`rebuildPlayerRankingPointsFromEventDeltas`).

## 4. Persistence & synchronisation

```
            saveState() — whole {players,tournaments} blob + CHANGE_KEY timestamp
 operator tab ───────────────────────────────► localStorage ◄──── other tabs (TV board)
      │  exportAllData() → JSON file                ▲   storage event → loadState()
      ▼                                             │   5 s tick → loadState() (tournament/TV views)
 operator uploads as data/latest.json (GitHub)      │   TV board 1–2.5 s timer → loadState()
      │                                             │
      ▼                                             │
 member device boot: fetch data/latest.json ── applyFullBackupData() → saveState()
   (skipped when operator mode is on, or ?local=1; on 404/error/invalid shape local data is kept)
```

- **Boot** (l.15437): `loadState` → `showView('home')` → watermark → operator button →
  `bootClubSnapshot` (async) → `ensureAppAutoRefresh` → `renderPlayers`.
- **Operator mode** is a localStorage flag toggled with a PIN prompt; it hides/shows import,
  export and admin controls and decides whether the snapshot is applied.
- **Concurrency model**: whole-blob last-writer-wins; no versioning or merge.
- **Render has side effects**: `renderMatches` calls `assignRankingRoundTables` and
  `fairPromoteAcrossEvents`, i.e. table/on-deck assignment is (re)computed during rendering.

## 5. Multi-event operation
Several events can be active at once. With **conflict lock** on (default), physical table
numbers are shared club-wide (`getGlobalLiveTableSet`, `listFreeTables`), a player live in one
event holds their match in another (`applyCrossConflictFlag`), and freed tables go to the
longest-waiting on-deck match across events (`fairPromoteAcrossEvents`).

## 6. Behavioral contracts verified by the test suite
See [TESTING.md](TESTING.md) for where each lives. All pass against v7.28 unless listed in
[AUDIT.md](AUDIT.md) as a discrepancy.

| # | Contract | Status |
|---|---|---|
| 1 | No player in two matches of the same ranking round; never on both sides | ✅ property-tested |
| 2 | Every team has exactly two distinct active players | ✅ property-tested |
| 3 | Sit-outs = active mod 4; sitters ∪ players = active field | ✅ property-tested |
| 4 | Sit priority: a sitter never has more prior sits than a playing veteran; spread ≤ 1 for players present all night; no avoidable back-to-back sits | ✅ property-tested (150 random nights) |
| 5 | Partner draws are repeat-free whenever a repeat-free draw exists | ✅ property-tested against an exact solver |
| 6 | Clean bracket play (3–24 entrants, SE/DE) terminates with distinct 1st/2nd/3rd; DE exit = exactly 2 losses; no double-booking; unique live tables | ✅ property-tested |
| 6b | …after a score **correction** | ❌ DISC-01/02/04 |
| 7 | Completed results stay stable unless explicitly edited | ❌ DISC-03 (opening the edit dialog clears Bo3 results) |
| 8 | Ranking applied once; repeated triggers / reload / snapshot load do not double count | ✅ (but ❌ DISC-07 on import-as-copy) |
| 9 | Recalculation deterministic, idempotent, independent of storage order; equals incremental totals | ✅ |
| 10 | Export → snapshot/import round-trip preserves players, events and ranking | ✅ in memory (❌ DISC-06: import is not persisted) |
| 11 | Reload restores exactly what was saved; member devices keep local data if the snapshot is missing/invalid | ✅ |
| 12 | Sandbox events never affect ranking | ✅ |
