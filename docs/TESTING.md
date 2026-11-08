# Testing LCFC Manager

The tests run the **real, unmodified `index.html`**. Nothing in the app was changed to make
it testable: a harness loads the page into [jsdom](https://github.com/jsdom/jsdom) (or real
Chromium via Playwright) and calls its functions directly.

## Quick start

```bash
npm ci                        # once (Node 20+)
npm test                      # unit + property + integration + regression (~1 min)
npm run check                 # syntax / version-marker / data/latest.json shape checks
npx playwright install chromium   # once, for browser tests
npm run test:e2e              # browser tests in Chromium (~5 s)
npm run test:discrepancies    # show the known discrepancies failing, with reproductions
npm run test:deep             # exploration: fresh random seeds, 150 nights per property (~5 min)
npm run serve                 # preview the app at http://localhost:4173/
```

Routine CI (`.github/workflows/ci.yml`, every push and pull request) runs `check`, `npm test`
and `test:e2e` as blocking jobs, plus a non-blocking "Known discrepancies" job.
Randomized exploration runs separately (`.github/workflows/stress.yml`: manual or weekly)
and never blocks anything.

## Layout

```
test/
  harness/
    loadApp.js        boots index.html in jsdom; seeded Math.random; stubs CDN/fetch/dialogs
    useApp.js         vitest fixture (one window per file, reset between tests)
    discrepancy.js    helper for documented discrepancies (see below)
    fcConfig.js       fast-check settings (PROP_RUNS, SHRINK, FC_SEED, FC_PATH)
  factories/
    random.js         mulberry32 seeded PRNG
    players.js        fabricated players (invented names) + adversarial names
    driver.js         drives the app like an operator: create event, add players,
                      generate rounds, enter scores via the score modal, playoffs, export/import
    scenarios.js      fast-check "night scripts": arrivals, departures, returns, interrupted rounds
    oracles.js        independent reference computations (exact partner-repeat optimum, sit counts)
  fixtures/synthetic-club.json   fabricated 3-night club backup (npm run fixtures regenerates)
  unit/               small pure helpers
  properties/         randomized invariants (ranking rounds, partners, brackets)
  integration/        persistence, ranking, playoffs, escaping
  regression/         guards for bugs the code comments say were fixed before
  discrepancies/      proposed invariants the current app violates — need owner review
  e2e/                Playwright: UI flow, member snapshot, TV board cross-tab
```

## Test categories (labels in test names)

| Label | Meaning |
|---|---|
| `[contract]` | Expected behavior derived independently from README / code comments; currently passes |
| `[char]` | Characterization: pins current behavior (even if questionable) so refactors can't change it silently |
| `[regression]` / `regression/` | Protects a previously fixed bug |
| property tests | Invariants checked over many generated scenarios |
| `[DISC-xx]` | Discrepancy: asserts a *proposed* invariant that v7.28 violates (see [AUDIT.md](AUDIT.md)) |

### How discrepancy tests work
They are **never weakened to pass**. In routine runs, `discrepancy()` (test/harness/discrepancy.js)
turns each one into a *check that the documented discrepancy still reproduces*:

| What the body does | Routine result | Meaning |
|---|---|---|
| fails with an **assertion** failure | ✅ pass | discrepancy still present, as documented |
| passes | ❌ `DISCREPANCY NO LONGER REPRODUCES` | behavior changed — review, update AUDIT.md, convert to a normal test |
| throws anything else (TypeError, timeout…) | ❌ `UNEXPECTED ERROR` | broken test/harness, not a domain finding |

So in CI, *expected* discrepancies are silent, while unexpected test or infrastructure failures
are red with a distinct message. (Vitest's plain `it.fails` was not used because it also
"passes" on crashes.)

`npm run test:discrepancies` (`STRICT=1`) runs them as ordinary tests so every failure and its
reproduction is printed; CI runs this as the informational, non-blocking "Known
discrepancies" job (expected to be red).

`exploratory()` is for proposed invariants that random search violates only rarely. It is
skipped everywhere except `EXPLORE=1` (the stress workflow). When it finds a case, capture
the seed as a deterministic `discrepancy` test (as was done for DISC-15).

## Reproducing a property-test failure
fast-check prints the seed and path of the failing case:
```bash
FC_SEED=<seed> FC_PATH=<path> npx vitest run test/properties/<file>
SHRINK=1 FC_SEED=<seed> npx vitest run ...   # shrink to a minimal night (slow)
```
Routine runs use a **fixed fast-check seed** (`DEFAULT_SEED` in `test/harness/fcConfig.js`), so
the same scenarios run every time and CI is deterministic. Exploration with fresh seeds
(`FC_RANDOM=1`, used by `npm run test:deep` and the stress workflow) may find a new
counterexample: copy the printed seed/path, reproduce locally with `FC_SEED`/`FC_PATH`, then
either add a deterministic `discrepancy` test (the app violates the invariant — needs owner
review) or fix the test (its assumption was wrong). Never "fix" it by changing the expectation.

Every app-level random choice uses the seeded `Math.random`, so a seed replays the same
draws, sit-outs and scores. (Ids from `uid()` include `Date.now()`, so tests never assert
on raw ids of generated tournaments.)

## Writing a new test
```js
import { it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
const ctx = useApp();                     // fresh club for every test

it('[contract] my rule', () => {
  const { app, d } = ctx;                 // app = page, d = operator driver
  const ids = d.addPlayers(9);            // fabricated players
  const t = d.createTournament({ type: 'monster', tables: 2 });
  d.addToEvent(t, ids);
  const round = d.generateRound(t);       // real generateRound()
  d.playRound(t);                         // real score modal, valid random scores
  expect(round.sitOutIds).toHaveLength(1);
  expect(app.call('computeStandings', t).length).toBe(9);   // call any app function
});
```
Tips:
- Use `app.toWindow(obj)` to pass plain objects into app functions (keeps arrays "native" to the page).
- `app.eval('someGlobal')` reads top-level `let`/`const` (e.g. `clubSnapshotMeta`).
- `loadApp({ operator:false, snapshot: {...} })` simulates a member device; `snapshot: 404 | 500 | 'network-error'`.
- `app.dialogs.confirm.push(false)` scripts the next `confirm()` answer (default: OK).
- Rendering is **not** stubbed: render functions mutate state (table assignment), so stubbing them would change behavior.

## Test data policy
- All players, events and results in tests and fixtures are **fabricated** (invented names
  such as "Rook Testwood"). Never copy real members or records from `data/latest.json` into tests.
- `npm run check` reads `data/latest.json` only to validate its *shape*.
- Browser tests intercept `data/latest.json` and serve synthetic data.

## Known gaps (not yet covered)
- Multi-event table sharing / conflict lock / `fairPromoteAcrossEvents` (only single-event tables are property-tested).
- Doubles and Singles ranking rounds, Round Robin format, Bo5, `drawStyle: highlow`.
- Stats/awards/Club DNA numbers, charts, player profile cards, share images.
- TV announcements (speech/audio), match timers, coin toss.
- localStorage quota exhaustion; Safari/iOS behavior; mobile layout.
- Visual regression (no screenshots compared).
