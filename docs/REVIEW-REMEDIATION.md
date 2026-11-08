# Independent review — remediation notes

**Review:** independent Codex review of `engineering/testing-foundation` at `29d6fb9`
(2026-11-08). Verdict at that commit: *not ready to merge* — findings F1–F7 concern the **test
infrastructure**, not the app.

**Remediation branch:** `engineering/review-remediation` (from `29d6fb9`).
**Scope:** test infrastructure, workflows, tooling and documentation only. `index.html` and
`data/latest.json` are byte-identical to the original repository (SHA-256 below). No tournament
rule, scoring, ranking or production behavior was changed; the security vulnerability (DISC-10)
was deliberately **not** fixed.

Every claim below is backed by a test that runs on every push (`npm test`, under
`test/selftest/`) or by a recorded run. "CI is green" is not used as evidence on its own.

## Summary

| Finding | Severity | Status | Proven by | Commit |
|---|---|---|---|---|
| F1 unrelated assertions accepted as known discrepancies | High | Fixed | `selftest/classifier.test.js` (22 probes + fault sweep of the real discrepancy suite) | `1a0b2cd` |
| F2 shared random state; counterexamples not replayable | Medium | Fixed | `selftest/replay.test.js` | `1a0b2cd` |
| F3 incomplete reset leaks state between tests/cases | Medium | Fixed | `selftest/isolation.test.js` | `1a0b2cd` |
| F4 security test swallowed exceptions, wrong tab ids | Medium | Fixed (vulnerability itself untouched) | `selftest/security-faults.test.js` | `16e1025` |
| F5 stress workload exceeded its timeout; no seed on timeout | Medium | Fixed | full 150-case run (below), `selftest/stress.test.js` | `dcf9bf7` (budgets/records in `1a0b2cd`) |
| F6 stress could stay green on failure; run count not honored | Medium | Fixed | `selftest/stress.test.js`, CI `stress-smoke` job | `dcf9bf7` |
| F7 non-podium guard could not tell right from reversed order | Medium | Repaired + narrowed; related guards audited; DISC-16 recorded | `selftest/mutations.test.js` | `31e257b` |
| Docs, `engines`, snapshot check | — | Updated | — | `ccbd854` |

## F1 — Expected-failure classification

**Problem.** `discrepancy()` caught the whole body and accepted *any* `AssertionError` (also via a
`cause` chain or a fast-check message), so a broken setup step counted as "known discrepancy".

**Correction** (`test/harness/discrepancy.js`). Each discrepancy declares one named
`checkpoint`; only an assertion raised inside `disc.observe('<checkpoint>', fn)` is tagged as the
observation. Accepted outcome: exactly that tag, or a property failure whose *direct* cause is
that tag. No `cause`-chain walking, no message matching. Additionally: page errors recorded in any
open window (or inside a property case) fail the test unless listed in `allowPageErrors`; a body
that ends without reaching the checkpoint fails (`CHECKPOINT NEVER REACHED`); a wrong checkpoint
name or an observation belonging to another discrepancy fails. All 24 existing discrepancy tests
were converted (26 now, with the DISC-01 fixture test and DISC-16): setup steps carry `'setup: …'`
assertions *outside* the checkpoint, so a broken prerequisite is reported as such.

**Tests added.** `test/selftest/probes/classifier.probe.js` (22 real `discrepancy()`
registrations) run in a child Vitest process by `test/selftest/classifier.test.js`, which asserts
each outcome and message. Exactly the 4 "EXPECTED" probes pass. The 18 failing probes include
the review's reproduction (DISC-03 with `submitScore` replaced by a no-op before the prerequisite
match → `UNEXPECTED FAILURE … an assertion OUTSIDE the declared checkpoint`, and the cancel path
is never reached), a TypeError whose cause is an assertion, a TypeError whose cause is a genuine
observation, an error whose message mentions `AssertionError`, unexpected pass, unreached
checkpoint, page errors, property-case failures, and a real 300 ms timeout.

**Fault sweep over the real discrepancy suite** (also a self-test): with
`LCFC_FAULT=noop-submitScore` the three DISC-03 tests fail as UNEXPECTED (they pass without the
fault), and only the five discrepancies that never score a match (DISC-08 ×3, DISC-10, DISC-13
"next round while live") still count as reproduced; every other one fails with a classifier label.
The first sweep found three tests whose final observation could also be produced by a broken
prerequisite — DISC-11 "accepts 7–5" (score never processed ⇒ "not accepted"), DISC-13 "playoffs
with a live ranking match" (round 1 never scored) and the DISC-15 fixtures (nights never scored) —
which now carry outcome-neutral setup checks (a new feedback toast; all matches scored). The same
sweep showed bracket helpers spinning 500 attempts on an unscored match (≈50 s per test); the
driver now fails fast naming the match.

**Side effects found and handled.** The stricter page-error rule surfaced two silent problems the
old classifier had accepted: (1) DISC-09's member device logged `Charts error … clearRect`
because jsdom has no canvas — the harness now provides an inert 2D context (like the existing
Chart.js stub) instead of filtering the message; (2) DISC-08's boot crashes are now allowed by
exact per-case patterns rather than wholesale.

## F2 — Reproducible randomized scenarios

**Problem.** Property cases shared the driver's random stream and the id counter across cases,
so a reported seed/path replayed a *different* scenario (review: score 2 in the run, 5 on replay).

**Correction** (`test/harness/scenario.js`). Every generated scenario is plain JSON with a
`seed`; each case runs via `runScenario` in a **fresh window** with `Math.random =
mulberry32(seed)`, a **fresh driver** `makeRng(seed)`, and ids restarting at `p_0001`. Nothing
crosses case boundaries. Properties are declared with `defineProperty` in non-test modules and
registered by id (`test/harness/registry.js`). On failure the message and
`test-results/scenarios/<id>__<seed>__<path>.json` record the scenario, fast-check seed and path,
the error and both replay commands; `npm run replay -- <fixture>` replays one scenario alone in a
new process. DISC-01's counterexample and DISC-15's two seeds are committed as scenario fixtures
in `test/fixtures/scenarios/`.

App and driver streams share the scenario seed (separate generator instances). This was kept
deliberately so the pinned DISC-15 seeds remain valid reproductions.

**Tests added** (`test/selftest/replay.test.js`): the review's probe shape (one scenario × 3
cases → 3 identical traces); a sensitivity control (an advanced driver stream *does* change the
trace); every case replays identically alone, in reverse order and after contaminating
scenarios; a failure on the **4th** case reports path `3`, writes a fixture, and replays via
`FC_SEED`/`FC_PATH` (only that case runs, identical trace), via the fixture, and in a **separate
process** via `npm run replay`; the committed DISC-01 fixture reproduces its discrepancy alone in a
new process. Traces are full Monster nights from production code (partners, sit-outs, tables,
scores).

**Discrepancy reproducibility after the change.** All documented discrepancies still reproduce
at their checkpoints. Change: DISC-01's random property previously depended on carried-over
driver state; with isolation, the pinned seed `20261108` now fails on its first case
`{"seed":8,"n":9,"format":"double-elim","playFirst":7}` (player p_0002 in two ready matches), which
is saved as `test/fixtures/scenarios/DISC-01-correction.json` and also tested directly.

## F3 — Application and test isolation

**Problem.** The shared-window fixture's `reset()` cleared players/tournaments only; settings,
other `state` fields, modal state, timers and substituted functions survived.

**Correction.** There is no in-place reset any more. `useApp` boots a fresh window for **every
test**; `runScenario` for **every generated case**; windows are closed afterwards (stopping their
timers). A registry of open windows plus `test/harness/setup.js` fails any test that leaves one
open; the id counter is reset at every test boundary. (Boot costs ≈175 ms, measured.)

**Tests added** (`test/selftest/isolation.test.js`): test A contaminates the bonus-split setting,
active score-match reference + open modal, `currentTab`, `statsActiveTab`, substituted
`downloadJson`/`submitScore`, a window global, `Math.random`, sessionStorage, body class, scripted
dialog answers, a toast, a live 5 ms timer, `storage`/`click` listeners, the id counter and the
driver stream; test B must equal an independently booted reference window, with restarted
streams and ids and no leaked timer/listener activity. A 5-case property in which every case
contaminates checks the same at each case start. A sensitivity control proves the comparison
detects each item the review listed. A child-process probe proves the open-window guard fails a
leaking test.

## F4 — Security test reliability

**Problem.** Tab navigation was wrapped in `try/catch`, and four of five stats tab ids were wrong
(`partners`, `crazy`, `charts`, `dna`; the app uses `week`, `career`, `ranking`, `club-dna`,
`awards`). A crashing view still passed.

**Correction** (`test/integration/security.test.js`). Real tab ids (from `setStatsTab`) and real
tab buttons; no exception handling. For each of 14 views the test requires the panel to be
visible and to contain the adversarial names as **text**, then checks no markup was injected and
no page errors occurred. AUDIT.md's "names are escaped everywhere" was narrowed to those 14 views.
DISC-10 (unescaped ids) is unchanged — not fixed in this milestone.

**Tests added** (`test/selftest/security-faults.test.js`): the real test fails with
`LCFC_FAULT=throw-statsTab-ranking` (the review's probe) and with `blank-renderPlayers` (a view
that silently renders nothing), and passes without a fault.

## F5 — Stress timeout and reproduction information

**Problem.** 150 cases per property exceeded the global 300 s Vitest timeout; the timeout output
named no seed or scenario.

**Correction.** Each property declares a per-case budget; its test timeout is `runs × budget +
60 s` and fast-check stops cleanly at `runs × budget` with an "INTERRUPTED … NOT a counterexample"
report. The fast-check seed is chosen by the harness and printed **before** the first case; the
case in progress is written to `<id>.inflight.json` before it starts; each run writes a record
(seed, requested/executed, slowest case).

**Verification: the actual default workload was re-run to completion** —
`node scripts/stress.mjs --runs 150` (fresh random seeds, all properties in parallel, 24-core
machine): 5 min 36 s wall, exit 0, every property executed 150 / 150 cases, seeds printed before
the first case:

| Property | Seed | Total | Avg / case | Slowest | Budget at 150 |
|---|---|---|---|---|---|
| bracket-clean (the one that timed out in the review) | 789492219 | 334 s | 2.2 s | 8.4 s | 1800 s |
| partners-repeat-free | 2139043741 | 242 s | 1.6 s | 5.6 s | 1200 s |
| ranking-round-structure | 877014745 | 172 s | 1.1 s | 5.8 s | 1200 s |
| ranking-round-steady-sit-spread | 2049147315 | 138 s | 0.9 s | 4.4 s | 1200 s |
| DISC-15-exploration | 1867291523 | 228 s | 1.5 s | 5.6 s | 1200 s |

This is one random sample on one machine; GitHub runners are slower. The budgets leave ≈4–5×
headroom, and exhausting one is reported as INTERRUPTED (not as a counterexample) and fails the
run. While collecting this evidence, a Playwright run wiped the run records (Playwright empties
`test-results/`); Playwright now writes to `test-results/playwright/`.

## F6 — Stress workflow integrity

**Problem.** DISC-15 exploration was `continue-on-error`, so the workflow could stay green with a
failure; `runs` reached only the first step (DISC-15 always ran 40).

**Correction.** `stress.yml` runs one step, `node scripts/stress.mjs --runs N`, which gives the
same `PROP_RUNS` to every property including DISC-15, and fails unless every expected property
ran exactly N cases and vitest succeeded. Unexpected failures, budget interruptions, skipped
properties and count mismatches all fail the job. A new DISC-15 instance (a known discrepancy) is
reported via warning annotation, job summary and fixture artifact, without failing. Fixtures and
run records are uploaded as an artifact (`if: always()`). Exploration stays out of the blocking
PR jobs; CI's `stress-smoke` job calls the **real** `stress.yml` with 3 cases and a fixed seed on
every push, so its plumbing is exercised continuously.

**Tests added** (`test/selftest/stress.test.js`): unit tests of the verification (vitest
failure, missing property, run count not honored — the exact F6 case, fewer cases executed,
interruption, counterexample, known DISC-15 finding), and a real stress run in a child process
with the app broken, which must exit 1 and leave a replayable fixture for each failing property.

## F7 — Regression test quality

**Problem.** The non-podium ordering guard checked monotonic loss counts, but every non-podium
player in double elimination has exactly 2 losses, so reversed order passed.

**Investigation.** `getEventFinishPlaces` sorts non-podium entries by fewer losses, then
ranking-round standings. Loss counts differ only in **single elimination with a bronze match**,
where the bronze-match loser (a semi-finalist, 2 losses) is placed **8th of 8**, behind the four
quarter-final losers (1 loss). The guarded comment's premise ("fewer losses = deeper run") does not
hold there.

**Correction.** The guard is narrowed and made discriminating: in Monster double elimination,
non-podium places must follow ranking-round standings exactly (with asserted preconditions: ≥3
non-podium teams, equal losses, distinct standings). The single-elim bronze behavior is recorded as
a new **DISC-16** discrepancy for an owner rules decision — not changed.

**Audit of related guards** (each now has a mutation probe in `test/selftest/mutations.test.js`,
which runs the same check body against an in-memory mutated `index.html`; a mutation must match
exactly once or the probe refuses to run):

| Guard | Finding | Action | Mutation caught |
|---|---|---|---|
| Non-podium order | Non-discriminating (F7) | Narrowed + exact order | Reversed standings tie-break ✅; evidence test shows the old check passes against it |
| Partners share a place | OK (non-podium teams exist) | Precondition asserted | Partners split into individual places ✅ |
| Stored deltas kept on backup load | **Fragile**: edited whichever player came first; a player whose real delta is 0 would make it vacuous (with its fixed seed the first player had +88, so not vacuous in practice) | Picks a non-zero delta | Wipe + recalculate on load ✅ |
| Late joiners don't sit | **Weak**: 1 late joiner of 9, ~1/9 chance per run to catch a random sitter | 3 late joiners × 6 nights | Rookies preferred to sit ✅ |
| Loss-key direction | Only single-elim bronze distinguishes it | DISC-16 | Reversed loss key moves bronze loser to 4th ✅ |
| Bye sanitizer, 900→2000 upgrade, geography migration | Direct unit inputs on both branches | none | — |

## Other review items addressed

- `package.json` `engines` now matches Vite's requirement (`^20.19.0 || >=22.12.0`).
- `npm run check` now rejects all three demonstrated boot-breaking snapshot shapes (incl. numeric
  tournament name, the review's probe); documented as partial validation.
- TESTING.md / HANDOFF: Playwright browser install, CDN/network dependency, accurate scenario
  counts ("55 generated cases per routine run", not "thousands"), "green = the checks passed for
  the exercised scenarios", new failure messages, stress semantics.

## Verification log

All on 2026-11-08. Local machine: Node 22.23.3, 24 cores. CI: GitHub Actions, Node 22.23.4.

| Check | Result |
|---|---|
| `npm run check` | pass (3 scripts parse, versions agree, snapshot shape ok) |
| `npm test` (final tree) | 21 files passed, 1 skipped; 144 tests passed, 2 skipped by design (DISC-15 exploration without `EXPLORE=1`; replay entry without `SCENARIO_FILE`) |
| `npm test` with shuffled order (`--sequence.shuffle --sequence.seed=4242`) | 144 passed, 2 skipped — no order dependence |
| Each commit in its own worktree (`1a0b2cd`, `16e1025`, `31e257b`, `dcf9bf7`) | each green on its own: 124 / 127 / 135 / 144 tests passed (production hashes checked in each) |
| `npm run test:discrepancies` (STRICT) | 26 failed (24 original + DISC-01 fixture + DISC-16), **every one at its tagged checkpoint** (25 directly, DISC-01 property via its direct cause) |
| Fault sweep `LCFC_FAULT=noop-submitScore` over `test/discrepancies` | 21 fail with a classifier label, 5 scoring-independent still reproduce (now a self-test) |
| Classifier probes | 22 probes: 4 expected pass, 18 fail with the asserted messages (incl. review repro and real timeout) |
| Replay | later-case failure replayed via FC_PATH, fixture and separate process; DISC-01 fixture reproduces alone via `npm run replay` |
| Isolation | contamination does not leak across tests or property cases; sensitivity control detects each leaked item from the review |
| Mutation probes | 5/5 mutations caught; previous F7 guard shown blind |
| Chromium (`npm run test:e2e`) | 4 passed (local, and in CI) |
| Bounded stress (`node scripts/stress.mjs --runs 3 --seed 20261108`) | pass, 3/3 cases per property (local, and in CI via the real `stress.yml`) |
| Full default stress (`--runs 150`, random seeds) | pass, 150/150 per property, 5 min 36 s (table in F5) |
| `gh workflow run stress.yml` on the branch | **not possible**: `HTTP 404: workflow stress.yml not found on the default branch` — exercised via CI's `stress-smoke` call instead |
| GitHub Actions run [42530290649](https://github.com/Minihercules317/foosball-app/actions/runs/42530290649) (head `ccbd854`) | Static ✅, Unit 144 passed / 2 skipped ✅, Browser 4 passed ✅, Stress workflow (3 cases, fixed seed) ✅ 3/3 per property, Known discrepancies ❌ by design: 26 failed, all at checkpoints |

CI timing note: the same bracket case took 13.8 s on the GitHub runner vs 7.5 s locally (≈1.8×).
Scaled, the 150-case bracket total (334 s locally) is ≈600–700 s on GitHub against its 1,800 s budget.

## Production files

| File | SHA-256 (original default branch `71c4a58`, review base `29d6fb9`, and every remediation commit) |
|---|---|
| `index.html` | `1430cfa07079ae7e1a2bf0858bdd8b70c6854dba55d577095163a7268dbf770a` |
| `data/latest.json` | `24767336b125881cd3826dc652e8021f95840b4ac349d50c5c07fdf42def1c78` |

`git diff 29d6fb9..HEAD -- index.html data/latest.json` is empty. Mutation probes only ever
mutate an in-memory string; `mutateHtml` never writes to disk.

## Remaining concerns for independent review

1. **jsdom is not a browser.** Canvas is an inert stand-in, Chart.js is a stub, layout is not
   computed. Escaping, rendering and charts are only browser-verified by the 4 Playwright tests,
   which depend on live CDNs (unpinned Tailwind).
2. **Shared seed for app and driver streams.** Deterministic and isolated per case, but the two
   generators produce the same sequence; kept for DISC-15 seed compatibility. Changing it would
   invalidate the pinned fixtures.
3. **Page errors** are enforced for discrepancies and every property case, but ordinary tests
   rely on their own `app.errors` assertions (most have one; not all).
4. **Isolation is per window.** Node-side module state added in the future outside
   `players.js`' counter is not reset automatically (documented convention + guard for open windows only).
5. **Mutation coverage is targeted, not exhaustive**: 5 mutations for the regression guards and 3
   named faults. Integration/contract tests outside `regression/` were not mutation-probed
   (e.g. "recalculation depends on event dates" was not checked for discrimination).
6. **Stress on GitHub**: the full 150-case workload was measured locally only. `stress.yml`
   cannot be dispatched on the fork until it exists on the default branch; its first full
   run on GitHub is the first real check of the budgets there. CI's `stress-smoke` job runs
   the real workflow file with 3 cases on every push.
7. **DISC-16 is new** (found during F7): needs owner review like the other discrepancies.
8. **Owner-facing items unchanged**: all DISC-01…16 behaviors remain, including DISC-10 (security).
9. The review's other gaps (multi-event tables, correction matrix, real-browser download/import,
   TV DOM) remain open and are listed in TESTING.md "Known gaps".
