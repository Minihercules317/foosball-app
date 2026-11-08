# Engineering Audit — LCFC Manager v7.28

*Audited 2026-11-08 on fork branch `engineering/testing-foundation`. No production code was
changed. Every item says how it was established:*

- **Test** — reproduced by an automated test in this repo (named in the item)
- **Code** — confirmed by reading the code line by line, no automated test yet
- **Reported** — found by an exploratory script during the audit and checked by reading the
  code, but not yet captured in the suite

Severity is from a weekly club operator's point of view. **Nothing here has been fixed.**
Each discrepancy needs a decision from the app's owner (see "Owner decision" lines).

## Summary

The core of what runs every week holds up well. These checks produced **no failures**
across hundreds of randomized club nights (re-verified 2026-11-08 with 150 fresh random cases
per property, each case in its own fresh window — see TESTING.md "Stress exploration"):
- Monster DYP ranking rounds: sit-out fairness, partner rotation (checked against an exact
  optimum solver), match structure and per-round table assignment.
- Clean bracket play: single and double elimination, 3–24 entrants.
- The ranking formula, idempotence and recalculation.
- Sandbox exclusion.
- The GitHub Pages snapshot distribution path.

Most real risk sits in four areas:
1. **Score corrections in brackets and best-of series.** Re-scoring, or even just opening
   "Edit score", can leave the bracket inconsistent: a player scheduled twice, a champion who
   never played the final, duplicate podium places.
2. **Import.** Imported data is never saved, so it disappears on reload. Importing an event as
   a copy double-counts its ranking.
3. **Robustness on load.** One malformed record stops the app from starting, and member
   devices then can't recover by themselves.
4. **Operational workflows** that silently replace or overwrite data: operator mode off,
   two tabs open at once, deleting a ranked event.

## A. Discrepancies (each has a failing reproduction in `test/discrepancies/`)

| ID | Sev | Area | Finding | How established |
|---|---|---|---|---|
| DISC-01 | **High** | Brackets | Correcting a bracket result clears only the next match downstream. Later rounds keep stale entrants, so a player can be in two ready matches at once, or an eliminated player stays scheduled. Lines: `submitBracketScore` l.9370–9388, `clearBracketMatch` l.8608–8626. A related path: cleared matches keep `_byePropagated`, so a losers-bracket bye doesn't re-advance. | Test: `bracket-corrections.test.js` (random property + single-elim-8 repro) |
| DISC-02 | **High** | Brackets | Bronze and grand-final results survive a change to their feeder, because only the side's entity is cleared, not `winner`. Example: re-scoring a semi-final in a 4-player bracket gives 1st=E4, 2nd=E1, 3rd=E4 while the event stays "finished". | Test |
| DISC-03 | **High** (Monster) | Scoring | **Opening** "Edit score" on a finished best-of-3/5 match wipes its result in memory at once (`openPlayoffScore` l.10400, `openScoreModal` l.9055). Closing the dialog doesn't restore it. (The persisted copy initially still holds the old result; cancelling alone was not shown to delete it from disk. Whether a later save persists the cleared result was not tested.) In a bracket, the downstream invalidation is also skipped (winner is already null at submit), so the re-entered semi-final winner becomes champion of a final they never played. Monster playoffs are always Bo3, so this sits in the weekly workflow. | Test (3 cases) |
| DISC-04 | Med | Brackets | Fixing a typo without changing the winner (5–1 → 5–2) still clears the next match's result, while placements still show the old champion. | Test |
| DISC-05 | Med | Ranking | Club ranking is applied once (`rankingApplied`) and never re-applied after a correction or "Replace bracket". Stored deltas then credit the old podium until someone manually runs "Recalculate". | Test |
| DISC-06 | **High** | Import | No import path calls `saveState()` (l.10580–10661). The toast says "Data replaced" or "Imported event", but a reload, another tab's save, or the 5-second refresh tick restores the old data. The import only sticks if some later action happens to save. | Test (full replace + single event) |
| DISC-07 | Med | Import / ranking | Importing an event that already exists and choosing Cancel ("keep both") creates a copy with identical `rankingDeltas`. Those points are counted twice. | Test |
| DISC-08 | Med (High if it occurs) | Robustness | A single malformed record (a `null` tournament, a missing `playerIds`, a non-string name) throws during the first render (`renderHome` l.5430 / `escapeHtml` l.12715) before auto-refresh and the snapshot fetch start. A member device that loaded a bad `latest.json` saves it locally and can't recover, even after the file is fixed, until site data is cleared. | Test (3 cases) |
| DISC-09 | Med | Ranking | Deleting a finished official event (`confirmDeleteTournament`, not operator-gated) leaves its deltas in the operator's player totals. Members rebuild totals from the remaining events' deltas, so the operator's leaderboard and the published one disagree. Manually edited `rankingPoints` are lost the same way on any import. | Test |
| DISC-10 | Low–Med | Security | Ids are put into `onclick="fn('${id}')"` and `value="${id}"` without escaping (Players list l.4968–4975, roster l.5773, match and bracket cards l.8487–8504, l.9954+, and others). An id containing `"` injects markup at boot. Normal `uid()` ids are safe, so exploiting it needs a crafted import or `latest.json`. The independent review executed injected JavaScript this way in Chromium. Names, by contrast, are escaped in the 14 views exercised by `integration/security.test.js` (not proven for every view). | Test |
| DISC-11 | Low–Med | Scoring | With the OT box ticked, the target is hard-coded to 8 (`quickRaceTo` l.9096). With race to 5, the 7–5 that the README and the error message both give as an example is rejected. With race to 10, 8–6 is accepted. | Test |
| DISC-12 | Med (DYP only) | Standings | DYP ranking rounds redraw partners every round, and the new teams get new ids. The team branch of `computeStandings` (l.9535) only counts matches between *current* teams, so earlier results disappear from standings. DYP tiered playoffs then fall back to roster order. Production data has only one DYP event, and it was bracket-only, so current impact is low. | Test |
| DISC-13 | Med | Scheduling | Table assignment never considers other live matches *in the same event*. Generating round N+1 while round N is still live puts two matches on T1, and starting playoffs with a ranking match still live can schedule the same player twice. Whether overlapping rounds is a supported workflow is an owner question. | Test (2 cases) |
| DISC-14 | Low | Merge | After merging players, `sitOutQueue` and `bonusPoolLocked.fieldIds` still reference the removed id. Neither affects scoring of finished events; the scoring-relevant references are covered by a passing contract test. | Test |
| DISC-15 | Low (rules question) | Partners | In rare late rounds of small fields, the draw has more repeat partnerships than the minimum possible. Example: 7 players, round 10, 4 playing: the app picks two second-time pairs (2 repeats), although a third-time pair plus a brand-new pair (1 repeat) was available. The alternative is better even by the app's own comparison (`fairPairPlayers` l.6944 ranks by forbidden repeats, then rematches), but the greedy builder (l.6899) always takes the lowest-count partner first, so it never generates that pairing. Seen in 2 of 1,925 random 2–10-round nights (about 0.1%), both with 7 players in round 10 (audit estimate; not independently replicated). **Whether the app's choice is worse for players is a club-rules judgement.** | Test: `partners.test.js`, 2 pinned scenario fixtures (found by a time-bounded random search) |
| DISC-16 | Low–Med (rules question) | Ranking | Non-podium places sort by "fewer bracket losses first" (`getEventFinishPlaces` sort at l.4309; comment at l.4238 "fewer bracket losses = deeper run"). In double elimination every non-podium entry has 2 losses, so this never matters there. In **single elimination with a bronze match**, the bronze-match loser — a semi-finalist, 2 losses — is placed **last** (8th of 8), behind all quarter-final losers (1 loss each). Places feed seed points (tier 3–4 vs 5–8). Found while repairing the non-podium regression guard (review F7); a mutation probe confirms that reversing the loss key moves the bronze loser to 4th. | Test: `ranking-places.test.js` |

**Owner decisions needed:**
- DISC-01–05: what a correction should do once later matches have been played: cascade and
  invalidate, block, or ask the operator?
- DISC-11: what "OT" means.
- DISC-12: should DYP ranking-round standings be per player, like Monster?
- DISC-13: is generating a round, or starting playoffs, while matches are live allowed?
- DISC-08: how bad records should be handled.
- DISC-15: is "fewest repeat pairs" the right goal, or is "no pair three times" preferred?
- DISC-16: where should a single-elimination bronze-match loser finish — 4th, or after the quarter-final losers?

## B. Risks in intended workflows (characterized, not failing)

These behave as designed, but the design can lose data. Tests marked `[char]` pin the current
behavior.

| ID | Sev | Risk | How established |
|---|---|---|---|
| R-01 | **High** | Entering the PIN to turn Operator mode **off** and then reloading replaces the operator's local data with `latest.json`, with no confirmation and no automatic backup. One toast is the only warning. `?local=1` protects only that one load. | Test `[char]` persistence.test.js |
| R-02 | Med | Saves rewrite the whole blob and the last writer wins. A tab whose score modal is open ignores other tabs' saves, then overwrites them on submit. | Test `[char]` |
| R-03 | Med | Every 5 seconds, tournament and TV views reload state from localStorage (`tickAppAutoRefresh` l.15248), so in-memory changes that weren't saved are discarded (this is the mechanism behind DISC-06). Render functions also mutate state: `renderMatches` reassigns tables and promotes on-deck matches. | Test `[char]` |
| R-04 | Low | The operator PIN is hard-coded and published in the README; the README itself calls it "a light gate". Most data-changing functions check operator mode only in the UI: delete tournament, delete round/match, clear bracket match, merge, add player, scoring, import. Practical impact is limited because member devices are overwritten by the snapshot on the next load. | Code |
| R-05 | Low–Med | `saveState()` has no try/catch around `localStorage.setItem`, and only 3 of 35 callers catch errors. When storage is full, a change appears to succeed and is then reverted. Avatar data URLs grow storage. | Reported (jsdom `storageQuota`) |
| R-06 | Med | Imports aren't validated: any shape is accepted, which feeds DISC-08. The replace path skips the `migratePlayer*` steps that `applyFullBackupData` runs. `mergePlayers` drops `avatarData` and overwrites names by id with no conflict check. | Code + Reported |
| R-07 | Low | `deletePlayer` removes the player from rosters and teams but leaves ids in rounds, playoffs and `rankingDeltas`. Events without `playerIds` throw. | Code |
| R-08 | Low | Stats count an unfinished Monster playoff series at 1–0 as a win: `resolveMatchOutcome` l.10761 calls `getTournamentBestOf(t)` without the `'playoff'` context. | Code |
| R-09 | Low | The full-import dialog shows a literal `\n\n` (l.10593, the source has `'\\n'`), so the "Cancel = replace all data" text is hard to read. A second confirm does guard the replace. | Code |
| R-10 | Low | Doubles standings drop matches against a team that contains an absent player, and the opponents lose those wins too (l.9541). | Reported |
| R-11 | Low | The standings CSV doesn't escape quotes, and a name starting with `=` is a spreadsheet formula. | Code |
| R-12 | Med | `cdn.tailwindcss.com` is unpinned, and the Tailwind docs say the Play CDN is not meant for production. An upstream release can change the live UI with no commit. Chart.js is pinned to 4.4.1. | Code |
| R-13 | Info | `data/latest.json` is served publicly from GitHub Pages with real members' names and home states. This is intended for members to see, but it's worth a deliberate privacy decision, since anyone on the internet can read it. | Code |
| R-14 | Low | Documentation drift: the README says v7.14 (the app is v7.28), `APP_LINES` reads 14237 (the file has 15481 lines), and some README rules differ from the code (OT, DISC-11). Sit-out priority puts veterans before brand-new arrivals, which refines the README's "no one sits twice until everyone has sat once". | Code |

## C. Verified as working (passing tests)

- Ranking rounds, across 150 random nights (stress run 2026-11-08) with late arrivals, departures, returns,
  interrupted rounds and 1–4 tables:
  - Valid teams; nobody double-booked; sit-outs = active players mod 4.
  - Fair sit priority, no avoidable back-to-back sits, and a sit spread of ≤1 for players
    present all night.
- Partner draws are repeat-free whenever a repeat-free draw exists, checked against an exact
  bitmask-DP optimum. Once repeats can't be avoided, see DISC-15.
- Single and double elimination with 3–24 entrants under random winners:
  - Every bracket terminates with distinct 1st/2nd/3rd.
  - In double elimination every non-champion exits after exactly 2 losses.
  - No double-booking, and live tables are unique.
- Monster tiered playoffs pair 1+(n/2+1), 2+(n/2+2), and so on. Absent players are excluded.
  With an odd field, the lowest eligible player sits out.
- Ranking:
  - Δ = (tier(expected) − tier(actual)) × 8 + bonus.
  - Bonuses sum to the locked 1% pool, and partners share the same Δ.
  - It is applied once, and reloads and snapshot loads don't double count.
  - Recalculation is deterministic, idempotent, independent of storage order, and equals the
    incremental totals.
  - Sandbox events are excluded.
- Persistence:
  - A reload restores exactly what was saved.
  - Export → member snapshot gives identical data and ranking.
  - Operator devices and `?local=1` skip the snapshot.
  - A 404, 500, network error or invalid snapshot keeps local data.
  - A storage event from another tab refreshes the view.
- Display names (player and tournament) render as text in the 14 views exercised: home,
  players list, player profile, stats (week, career, ranking, Club DNA, awards), event tabs
  (players, matches, standings, bracket) and TV board. Each view is checked to have actually
  rendered the names; other views are not covered.
- Regression guards from the code comments' "previously fixed" notes all hold:
  - Pending feeds aren't treated as byes.
  - Partners share a place.
  - In Monster double elimination, non-podium places follow ranking-round standings. (The
    "fewer losses first" direction only matters for single-elim bronze losers — see DISC-16.)
  - Stored deltas are preserved on load.
  - The 900→2000 upgrade, the late-joiner sit rule, and the geography migration work.

## D. Unconfirmed hypotheses (no reproduction; not to be treated as bugs)

- **Losers-bracket layout.** The losers bracket is valid but not the standard layout. For
  N=12, losers from WB round 2 can meet each other, and byes may be unevenly distributed, so
  early rematches are possible. Clean-play invariants all hold (section C). (bracket subagent)
- **Multi-event table collisions.** The table-share path (`fairPromoteAcrossEvents`, conflict
  lock) is untested. Collisions across events are not ruled out.
- **TV board re-renders during announcements.** The global 5-second tick re-renders the TV
  board even while an announcement is playing, because it ignores `isTvBoardRefreshAllowed`.
  Not tested; needs a browser with speech.
- **Downloads in Safari/iOS.** `downloadJson` revokes the object URL immediately after
  `click()`, which can break downloads there. Not tested.
- **`deletePlayer` inside a finished bracket event** could break rendering or stats.
  Rendering with missing players worked in exploratory runs.

## E. Scope notes and method
- Discrepancy tests run in routine CI as "still fails at its declared checkpoint" checks: only
  an assertion inside the named final observation counts. Setup failures, crashes, page errors,
  timeouts, or a discrepancy that stops reproducing fail CI with a distinct message (see
  TESTING.md; proven by `test/selftest/`). Routine property tests use a fixed seed, every case in
  its own fresh window. Randomized exploration runs in the separate stress workflow.
- Revised 2026-11-08 after an independent review of the test infrastructure; see
  [REVIEW-REMEDIATION.md](REVIEW-REMEDIATION.md). DISC-01's random property now replays from a
  saved scenario fixture; DISC-16 was added; the claims about name escaping and non-podium
  order were narrowed to what the tests show.
- Two subagents ran read-only investigations in parallel: bracket/scoring and
  persistence/security. Their findings were reproduced independently in this repo's harness
  before inclusion. One claim, "a single-event import is discarded by the auto-refresh tick",
  did **not** reproduce as stated: opening the event happens to save it. The underlying defect
  (the import itself never saves) did reproduce, through a reload.
- The production `data/latest.json` was read **for schema and aggregate statistics only**.
  Stored player totals equal the totals rebuilt from per-event deltas (no drift today), and
  no event is flagged as ranked without deltas. No real names appear in any test or fixture.
- Not audited in depth: stats/awards math, charts, TV speech/audio, timers, coin toss, mobile layout.
