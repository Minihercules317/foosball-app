# Staged Refactoring Roadmap

**Goal:** make future changes safe, not make the code fashionable. The single-file static
app, localStorage, and the manually published `data/latest.json` are deliberate and stay.
No framework, backend, database or build step is proposed. Every stage below must leave the
app deployable as the same `index.html` on GitHub Pages and keep the test suite green.

**Gate for every stage:** `npm run ci` green, `npm run test:discrepancies` unchanged
(unless the owner approved a behavior change), and a manual Monster-night smoke test.
**Behavior changes** (anything in AUDIT.md marked "needs owner decision") are *not* part of
refactoring and need explicit approval from the app's owner first.

## Natural module boundaries found in `index.html`

| Module | Functions (examples) | Coupling today | Pure? |
|---|---|---|---|
| Domain model / entity helpers | `entityPlayerIds`, `rankingEntityPlayerIds`, `pairKey`, `makeSide`, `entityPayload` | reads `state.players` | almost |
| Matchmaking (ranking rounds) | `computeSitNeeded`, `pickFairSitOuts`, `getPartnershipData`, `fairPairPlayers`, `pairRankingEntities` | reads `t` + `state.players`; uses `Math.random`; mutates `t.sitOutQueue` | almost |
| Brackets | `buildSingleElimBracket`, `buildDoubleElimBracket`, `propagateBracketResult`, `feedEntity`, `buildTieredPlayoffTeams` | `uid`, `shuffle`, coin toss | almost |
| Scoring rules | `quickResultValid`, `tallySeriesFromGames`, `isSeriesComplete`, `getTournamentBestOf`, `computeStandings` | `quickRaceTo` reads the DOM | partly |
| Ranking | `getEventFinishPlaces`, `applyRankingPointsForTournament`, `recalculateClubRankingsFromEvents`, `splitBonusPoolShares` | mutates `state.players`; reads localStorage (bonus split) | no |
| Tables / multi-event | `assignRankingRoundTablesForMatches`, `assignBracketTables`, `fairPromoteAcrossEvents`, conflict lock | reads all `state.tournaments`; called from render | no |
| Persistence | `loadState`, `saveState`, `applyFullBackupData`, import/export, snapshot boot, auto-refresh | localStorage, fetch, timers | no |
| UI rendering | `render*`, modals, TV board, stats, charts | everything | no |

## Stages (ranked by risk ↑ and benefit)

### Stage 0 — Done in this milestone (no production change)
Harness, factories, property/integration/e2e tests, CI, documentation.

### Stage 1 — Low risk · High benefit: guard rails without touching behavior
- Keep `npm run check` in CI (syntax, version markers, snapshot shape). Consider adding a
  `data/latest.json` check that every tournament has `id` + `playerIds` (blocks DISC-08 from reaching members).
- Pin the Tailwind CDN script to an exact version (the Play CDN URL is unpinned today; an
  upstream release can change the live UI with no commit). *Needs owner OK: it is a runtime change, even if invisible.*
- Add an `ONBOARDING`/contributor note: "run `npm run ci` before uploading a new `index.html`".
- Extend tests to the gaps in TESTING.md, especially multi-event table sharing (most complex untested code).

### Stage 2 — Low risk · Medium benefit: extract pure logic *inside* the file
Move pure functions into clearly delimited sections (or an inline `const LCFC = (() => {...})()`
namespace) **without changing their bodies**, re-exporting the same global names so every
`onclick` keeps working. Candidates, in order: scoring rules → bracket builders/propagation →
matchmaking → ranking math. Tests already call these by their global names, so they prove
nothing changed. Do one module per release.

### Stage 3 — Medium risk · High benefit: separate state mutation from rendering
- Make `renderMatches` / `renderTournament` side-effect free by moving `assignRankingRoundTables`
  and `fairPromoteAcrossEvents` into the actions that change state (score saved, round
  generated, table count changed) and calling save there. Today render frequency (including
  the 5 s auto-refresh) influences table assignment.
- Characterization tests for table/on-deck assignment across multiple events **must be
  written first** (gap noted in TESTING.md).

### Stage 4 — Medium risk · High benefit: persistence boundary
- One `persist(mutator)` helper that applies a change and saves, used by all actions
  (import, delete, edits). This is where DISC-06 (import not saved) would naturally be fixed —
  once the owner approves.
- Defensive load: validate/normalise records on `loadState` and on snapshot apply so one bad
  record cannot stop boot (DISC-08). Needs owner agreement on what to do with bad records
  (skip + warn is the conservative option).
- Optional: a revision counter in the blob so a stale tab cannot silently overwrite a newer save
  (R-02). Behavior change → owner decision.

### Stage 5 — Higher risk · High benefit: bracket correction model
Score corrections are the area with the most confirmed defects (DISC-01…05). A safe design
(e.g. "re-scoring a match invalidates every match fed by it, recursively, and re-opens the
event") is a **rules decision** for the owner: should a correction cascade, be blocked
when downstream matches were played, or require confirmation? Implement only after that
decision, with the existing DISC tests converted to contracts.

### Stage 6 — Optional, only if the file becomes unmanageable
Split `index.html` into a few plain `<script src>` files (still no build step, still static
hosting). Only after stages 2–4, and only if the owner's AI-assisted workflow handles multiple
files well — a single file is currently a feature for that workflow.

## Explicitly not recommended
- Rewriting in React/Vue/Svelte, adding a backend or database, or TypeScript conversion.
- Changing sit-out, partner, seeding, tiering or ranking rules as part of "refactoring".
- Bundlers/build steps that would make `index.html` no longer the deployable artifact.
