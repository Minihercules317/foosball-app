# Testing LCFC Manager

The tests run the **real, unmodified `index.html`**. Nothing in the app was changed to make
it testable: a harness loads the page into [jsdom](https://github.com/jsdom/jsdom) (or real
Chromium via Playwright) and calls its functions directly.

## Quick start

Requires Node `^20.19.0 || >=22.12.0` (Vite, used by Vitest, needs it).

```bash
npm ci                        # once
npm test                      # unit, property, integration, regression, discrepancy and self-tests (~1–2 min)
npm run check                 # syntax / version-marker / data/latest.json shape checks
npx playwright install --with-deps chromium   # once per machine: browser + its Linux libraries
npm run test:e2e              # browser tests in Chromium (~10 s; needs network, see below)
npm run test:discrepancies    # show the known discrepancies failing, with reproductions
npm run test:stress -- --runs 30          # exploration with fresh random seeds, verified run counts
npm run test:deep             # the full weekly workload: 150 random cases per property (~6 min on 24 cores)
npm run replay -- <fixture.json>          # replay ONE saved scenario alone, in a fresh process
npm run serve                 # preview the app at http://localhost:4173/
```

**Browser tests need the network.** They load the production Tailwind CDN (unpinned) and
Chart.js CDN exactly as GitHub Pages does, so they can fail because a CDN is down or changed,
independent of any repo change. They are an end-to-end smoke test, not a hermetic one.
`data/latest.json` is always intercepted with synthetic data.

Routine CI (`.github/workflows/ci.yml`, every push and pull request) runs `check`, `npm test`
and `test:e2e` as blocking jobs, a non-blocking "Known discrepancies" job, and the stress
workflow with a tiny fixed workload (3 cases, fixed seed) to keep its plumbing honest.
Full randomized exploration (`.github/workflows/stress.yml`) runs weekly or manually.

## Layout

```
test/
  harness/
    loadApp.js        boots index.html in jsdom; seeded Math.random; stubs CDN/fetch/dialogs/canvas;
                      registry of open windows; in-memory HTML mutation (mutateHtml) for mutation probes
    setup.js          global: id counter reset per test; a test that leaves a window open FAILS
    useApp.js         vitest fixture: a FRESH window + driver for every test
    scenario.js       runs each generated case in its own fresh window; seed/path/fixture reporting;
                      per-property time budgets; run records (defineProperty / propertyTest / checkProperty)
    discrepancy.js    checkpoint-based expected-failure classifier (see below)
    faults.js         named TEST-ONLY fault injections (LCFC_FAULT) used by self-tests
    registry.js       every property by id (for replay)
    fcConfig.js       fast-check settings (PROP_RUNS, SHRINK, FC_SEED, FC_PATH, FC_RANDOM)
  factories/          seeded PRNG, fabricated players, operator driver, night scripts, oracles
  fixtures/
    synthetic-club.json        fabricated 3-night club backup (npm run fixtures regenerates)
    historical/*.json          fabricated event really played by an OLDER app version (stored old
                               ranking deltas); `npm run fixtures -- --historical <v7.28 index.html>`
    scenarios/*.json           saved, replayable scenarios (DISC-01 v7.34 counterexample, DISC-15 seeds;
                               DISC-01-resolved-v734.json = the v7.28 counterexample, now a regression test)
  unit/ properties/ integration/ regression/ discrepancies/   (as labelled below)
  properties/defs/    property definitions (non-test modules, so replay can import them)
  regression/checks.js  regression check bodies, shared with the mutation probes
  regression/resolved-discrepancies.test.js  former discrepancy checks resolved in v7.34
  selftest/           tests OF THE TEST INFRASTRUCTURE (classifier, replay, isolation, mutations, stress)
  selftest/probes/    deliberately failing probes, run only in a child process by selftest/
  selftest/fixtures/  synthetic replay fixture (deliberately wrong claim) used by selftest/replay.test.js
  replay/             replay entry point (runs only with SCENARIO_FILE; used by npm run replay)
  e2e/                Playwright: UI flow, member snapshot, TV board cross-tab
```

## Test categories (labels in test names)

| Label | Meaning |
|---|---|
| `[contract]` | Expected behavior derived independently from README / code comments; currently passes |
| `[char]` | Characterization: pins current behavior (even if questionable) so refactors can't change it silently |
| `[regression]` / `regression/` | Protects a previously fixed bug; each is mutation-probed (below) |
| property tests | Invariants checked over generated scenarios |
| `[DISC-xx]` | Discrepancy: asserts a *proposed* invariant that the current app (v7.34) violates (see [AUDIT.md](AUDIT.md)) |
| `[regression] [DISC-xx]` | A discrepancy resolved by an app release, kept as an ordinary test (`regression/resolved-discrepancies.test.js`) |
| `selftest/` | Proves the harness itself: classifier, replay, isolation, mutation sensitivity, stress plumbing |

## Isolation guarantees

- **Every test gets a freshly booted window** (`useApp`), and **every generated property case
  gets its own freshly booted window** (`runScenario`). Fresh means: app `state`, all top-level
  globals, settings in localStorage, sessionStorage, open modals, substituted functions,
  `Math.random`, timers and event listeners all start from the page's own boot.
  Windows are closed afterwards, which stops their timers.
- There is **no in-place reset**. A partial reset was shown to leak the bonus-split setting,
  the active score-match reference, the current tab and a substituted `downloadJson` (review F3).
- The fabricated-player id counter restarts at `p_0001` for every test and every case; each
  case gets a new driver whose random stream starts at the scenario's seed.
- `test/harness/setup.js` fails any test that leaves a window open.
- Proven by `test/selftest/isolation.test.js`: a test (and each property case) deliberately
  contaminates all of the above; the next test/case is compared against an independently booted
  reference window and must be identical; a sensitivity control shows the comparison does
  detect each contaminated item.

What is *not* isolated: Node-side module state you add yourself (keep factories stateless or
reset them in `setup.js`), and the browser tests (Playwright gives each test its own context).

## How discrepancy tests work

They are **never weakened to pass**. Each declares **one named checkpoint**: the final
observation that demonstrates it. Setup runs normally; only that observation is wrapped:

```js
discrepancy('DISC-03', 'cancel keeps the winner', { checkpoint: 'winner-after-cancel' }, (disc) => {
  ...setup — any failure here is a real failure...
  expect(m.winner, 'setup: the match was won by side a').toBe('a');   // setup assertion
  app.call('openPlayoffScore', m.id); app.call('closeScoreModal');
  disc.observe('winner-after-cancel', () => expect(m.winner).toBe('a'));  // the discrepancy
});
```

In routine runs the test **passes only if** the body fails with an assertion raised inside
`observe()` at the declared checkpoint (directly, or as the *direct* cause of a property
failure), and no unexpected page errors were recorded. Everything else fails:

| What happened | Routine result |
|---|---|
| assertion failed inside `observe(<declared checkpoint>)` | ✅ pass — still reproduces as documented |
| checkpoint reached, invariant held | ❌ `DISCREPANCY NO LONGER REPRODUCES` — review, update AUDIT.md, convert to a normal test |
| body finished without reaching the checkpoint | ❌ `CHECKPOINT NEVER REACHED` — the scenario no longer sets up the situation |
| assertion outside `observe()` (setup / cleanup) | ❌ `UNEXPECTED FAILURE … an assertion OUTSIDE the declared checkpoint` |
| TypeError / any other exception — even one whose `cause` is an assertion or observation | ❌ `UNEXPECTED FAILURE … a TypeError was thrown` |
| wrong checkpoint name, observation from another discrepancy, non-assertion inside `observe()` | ❌ `UNEXPECTED FAILURE` |
| the app logged/threw errors not in the test's `allowPageErrors` | ❌ `UNEXPECTED PAGE ERRORS` |
| timeout | ❌ Vitest timeout (nothing is caught) |

Mark setup assertions with a `'setup: …'` message so failures read clearly. `allowPageErrors`
must list exact patterns (DISC-08 allows only the specific boot crash it documents).

Proven by `test/selftest/classifier.test.js`: 22 probes run as real registered tests in a child
Vitest process (including the review's reproduction — `submitScore` replaced by a no-op before
DISC-03's prerequisite match — and a real timeout); exactly the 4 "EXPECTED" probes pass. The
same file runs the DISC-03 scenarios (`selftest/probes/fault-injection.probe.js`) with
`LCFC_FAULT=noop-submitScore` (all must fail as UNEXPECTED), without it (all must pass) and with
no fault at all (all must report NO LONGER REPRODUCES), and runs the **real** discrepancy suite
with `noop-submitScore` (only the five that never score a match may still reproduce).

The self-tests do **not** depend on a live application bug. v7.34 fixed DISC-03, so its v7.28
defect ("opening Edit score wipes a finished series") is re-injected by the test-only fault
`reintroduce-disc03-open-wipe` (`test/harness/faults.js`, copied from the v7.28 code); the replay
self-test uses a synthetic fixture with a deliberately wrong claim instead of the DISC-01 fixture.
When a self-test needs a known discrepancy, inject one — never point it at an open app defect.

**When a discrepancy stops reproducing** (`DISCREPANCY NO LONGER REPRODUCES`): check the app state
the scenario leaves (not just the pass), record the fix in AUDIT.md (section A2), and move the
check unchanged to `test/regression/resolved-discrepancies.test.js` (setup assertions →
`precondition:`, checkpoint → ordinary assertion). If only some of its checks stopped
reproducing, keep the finding open with a fresh counterexample (DISC-01).

`npm run test:discrepancies` (`STRICT=1`) runs them as ordinary tests so every failure and its
reproduction is printed; CI runs this as the informational, non-blocking "Known discrepancies" job.

`exploratory()` is for proposed invariants that random search violates only rarely; it runs only
with `EXPLORE=1` (stress). Same classification, except a violation at the declared checkpoint is
*recorded* (warning annotation, job summary, scenario fixture) instead of failed — it is a new
instance of a known discrepancy — and the exploration **continues**, so the requested number of
cases still runs. Any other failure fails the stress run, and so does a run that stopped short of
the requested case count, whatever the reason (`scripts/stress-lib.mjs`). The fixture's
`replay.fastCheck` command carries `EXPLORE=1`, the test file and an escaped `-t` filter.

## Randomized scenarios: reproduction and replay

Each property is a `defineProperty({ id, arbitrary, defaultRuns, caseBudgetMs, run })` in a
non-test module, registered with `propertyTest(def)`. Every generated **scenario is plain JSON
with a `seed`**; the case runs in a fresh window with `Math.random = mulberry32(seed)`, a fresh
driver stream `makeRng(seed)` and ids from `p_0001`. Its outcome depends only on the scenario
JSON — not on earlier cases, order or process. (App and driver streams share the seed by design:
that is how the pinned DISC-15 seeds were found, so they stay valid.)

Before any case runs, each property prints `[property <id>] fast-check seed=… runs=… budget=…`.
When a case fails, the error message and `test-results/scenarios/<id>__<seed>__<path>.json`
contain the scenario, fast-check seed and path, the error, and two replay commands:

```bash
npm run replay -- test-results/scenarios/<file>.json        # this scenario alone, fresh process
FC_SEED=<seed> FC_PATH=<path> npx vitest run <file> -t "<title>"   # through fast-check
SHRINK=1 FC_SEED=<seed> npx vitest run <file>                # shrink (sound now: cases are isolated)
```

Before each case, `<id>.inflight.json` names the case being run, so a run killed mid-case still
identifies it. Every property run also writes `test-results/property-runs/<id>.json` (seed,
requested vs executed cases, slowest case) — the stress run verifies these.

To keep a counterexample, copy its scenario into `test/fixtures/scenarios/` (see the DISC-01 and
DISC-15 fixtures) and replay it with `runScenario` in a deterministic test. Never "fix" a
failure by changing the expectation.

Proven by `test/selftest/replay.test.js`: the review's probe (same scenario, three cases, three
identical traces); a sensitivity control (an advanced driver stream *does* change the trace);
every case replays identically alone, in reverse order and after contaminating scenarios; a
failure on the **4th** case replays via `FC_SEED`/`FC_PATH` (only that case runs, identical
trace), via its fixture, and **in a separate process** via `npm run replay`.

Ids from `uid()` include `Date.now()`, so tests never assert on raw ids of generated
tournaments or matches.

## Stress exploration

`node scripts/stress.mjs --runs N [--seed S]` (used by `stress.yml`) runs every property and the
DISC-15 exploration with `PROP_RUNS=N` — the same N for all of them — and fresh random seeds
unless `--seed` is given. It **fails** (non-zero exit, red workflow) if vitest fails, any property
is interrupted by its time budget, any property did not run, or any property executed a
different number of cases than requested. Scenario fixtures and run records are uploaded as the
`stress-scenarios` artifact; a summary table goes to the job summary.

Time budgets: each property declares a per-case budget (measured worst case with headroom). Its
test timeout is `runs × budget + 60 s`, and fast-check stops cleanly at `runs × budget` with an
"INTERRUPTED … (time budget exhausted — NOT a counterexample)" report naming the seed and the
in-flight case. Override with `PROP_CASE_BUDGET_MS`. Measured on 2026-11-08 with the actual default workload
(`node scripts/stress.mjs --runs 150`, fresh random seeds, all properties in parallel on a
24-core machine; 5 min 36 s wall, 23.5 CPU-minutes; exit 0):

| Property | fast-check seed | Executed | Total | Avg / case | Slowest case | Budget at 150 |
|---|---|---|---|---|---|---|
| bracket-clean | 789492219 | 150 / 150 | 334 s | 2.2 s | 8.4 s | 1800 s |
| partners-repeat-free | 2139043741 | 150 / 150 | 242 s | 1.6 s | 5.6 s | 1200 s |
| ranking-round-structure | 877014745 | 150 / 150 | 172 s | 1.1 s | 5.8 s | 1200 s |
| ranking-round-steady-sit-spread | 2049147315 | 150 / 150 | 138 s | 0.9 s | 4.4 s | 1200 s |
| DISC-15-exploration | 1867291523 | 150 / 150 | 228 s | 1.5 s | 5.6 s | 1200 s |

GitHub's 4-vCPU runners are slower; the budgets leave ≈4–5× headroom on each total. If a weekly
run is ever INTERRUPTED, that is a capacity signal (raise the budget or lower `--runs`), and the
report says so explicitly rather than presenting it as a counterexample.

Output locations: `test-results/scenarios/` and `test-results/property-runs/` (Vitest);
Playwright uses its own `test-results/playwright/` (it empties that folder on every run).

Proven by `test/selftest/stress.test.js` (verification logic + a real stress run with the app
broken must exit non-zero with fixtures) and by CI's `stress-smoke` job, which calls the real
`stress.yml` on every push with 3 cases and a fixed seed.

## Mutation probes (do the tests discriminate?)

`test/selftest/mutations.test.js` boots an **in-memory mutated copy** of `index.html`
(`mutateHtml`; the file on disk is never touched, and a mutation that doesn't match exactly once
is refused) that reintroduces a guarded bug or reverses a rule, then runs the same check body as
the regression test. Each check must fail on its main assertion, not on a `precondition:`.
Covered: non-podium order (reversed standings tie-break), partners sharing a place, late joiners
(rookies preferred to sit), stored deltas on backup load (wipe + recalculate), loss-key
direction (only the single-elim bronze case distinguishes it — DISC-16), and bracket-only team
ranking (bracket-seed backfill removed = the v7.28 behavior; see below).

### Bracket-only team events rank by bracket seed (owner-confirmed, v7.32)

`test/regression/team-seed-ranking.test.js` pins a rule the owner confirmed on 2026-11-11: in a
team event that goes straight to a bracket (Doubles; DYP or Monster started bracket-only), a
team's **expected finish is its bracket seed**. Up to v7.28 the app averaged the partners'
individual club-rank positions instead, which inflated every seed adjustment. The expected
numbers are derived by hand from the README formula (the derivation is in
`test/regression/checks.js`), not read from the app. Five tests, all 8 players / 4 teams:
Doubles upset, Doubles "everyone finishes as seeded" (adjustment must be 0), DYP single-elim,
Monster with shuffled seeds, and a recalculation of a fabricated Doubles event that v7.28 really
scored (`test/fixtures/historical/`), which must come out with the corrected numbers. All five
fail against v7.28 and against the mutation probe, on the ranking assertion.

**Starting points follow the owner-confirmed ranking model** (everyone starts at 2,000; points
come only from recorded results; Recalculate resets to 2,000 and replays events by date — see
AUDIT.md). The four live cases first play a recorded history of four fabricated Singles brackets
(`TEAM_EVENT_HISTORY` in `test/factories/driver.js`), which gives the 8 players distinct points
with every pair sum distinct. Each case asserts as preconditions that the history produced the
pinned `TEAM_EVENT_POINTS` (from which the table is derived) and that they equal 2,000 + each
player's recorded deltas. After checking Δ, expected finish, podium, the locked bonus pool and
final club points, it runs **Recalculate** and requires the same Δ, history deltas and totals.
Until 2026-11-11 these cases hand-set the starting balances instead; v7.34's automatic ranking
rebuild (DISC-17) erases such balances, which is why the four tests failed on v7.34 (Δ, seeds,
podium and pool still matched). The committed v7.28 fixture keeps its original hand-set balances
(only its stored deltas and Recalculate are used); `scripts/generate-fixtures.mjs --historical`
still regenerates it exactly.

## Writing a new test
```js
import { it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
const ctx = useApp();                     // fresh window + driver for this test

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
For a randomized test, write a `defineProperty` in a non-test module and register it with
`propertyTest(def)`; add it to `test/harness/registry.js` so its failures can be replayed.
Never reuse a window across generated cases.

Tips:
- Use `app.toWindow(obj)` to pass plain objects into app functions (keeps arrays "native" to the page).
- `app.eval('someGlobal')` reads top-level `let`/`const` (e.g. `clubSnapshotMeta`).
- `loadApp({ operator:false, snapshot: {...} })` simulates a member device; `snapshot: 404 | 500 | 'network-error'`.
- `app.dialogs.confirm.push(false)` scripts the next `confirm()` answer (default: OK).
- Boot extra windows with `loadApp()` and close them (`afterEach`), or the isolation guard fails the test.
- Rendering is **not** stubbed: render functions mutate state (table assignment), so stubbing them would change behavior.

## Test data policy
- All players, events and results in tests and fixtures are **fabricated** (invented names
  such as "Rook Testwood"). Never copy real members or records from `data/latest.json` into tests.
- `npm run check` reads `data/latest.json` only to validate its *shape*. That validation is
  **partial**: it rejects the three record shapes shown to break boot (DISC-08), not every bad shape.
- Browser tests intercept `data/latest.json` and serve synthetic data.

## Known gaps (not yet covered)
- **Multi-event** table sharing / conflict lock / cross-event player contention / `fairPromoteAcrossEvents`
  (round properties check one round of one event at a time). Highest-priority gap.
- Score corrections across Bo1/3/5, undo/clear, descendants and grand-final reset, with reload and
  ranking-history checks (beyond DISC-01 and the resolved DISC-02…05 checks).
- Independent ranking examples beyond the 4-team bracket-only cases above (both bonus splits, ties, zero floor,
  event-date edits). Recalculation agreeing with the incremental path is consistency evidence,
  not an independent oracle.
- Real-browser export/download → import → reload; malformed input; storage failures. jsdom tests
  replace `downloadJson`, so they don't validate the download mechanism.
- Doubles and Singles ranking rounds, Round Robin format, Bo5, `drawStyle: highlow`, larger brackets.
- Stats/awards/Club DNA numbers, charts, player profile cards, share images; TV board DOM after
  refresh (the cross-tab browser test checks state, not the visible board).
- TV announcements (speech/audio), match timers, coin toss; localStorage quota; Safari/iOS; mobile layout.
- Display-name escaping is verified only in the 14 views listed in `test/integration/security.test.js`.
- Visual regression (no screenshots compared).
