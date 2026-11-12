# Handoff: working on LCFC Manager safely (for the developer's AI assistant)

You are helping the owner of **LCFC Manager**, a single-file foosball club app (`index.html`)
used every week at real club nights. The owner does not program; you make the changes. This
repository now has an automated test suite. This page explains how to use it so your changes
don't silently break anything. Read it fully before your first change.

## 1. Non-negotiable rules

1. **`index.html` stays the app.** It must keep working when opened from GitHub Pages with no
   build step. Do not add frameworks, bundlers, a backend, or a database.
2. **Current behavior is the baseline.** Sit-out order, partner rotation, seeding, tiered
   playoffs, ranking points and bonus splits are club rules. Change them only when the owner
   explicitly asks, and say clearly which tests will change and why.
3. **Run the tests before every upload of `index.html`:**
   ```bash
   npm ci                                         # first time only (Node ^20.19 or >=22.12)
   npx playwright install --with-deps chromium    # first time only, per machine
   npm run ci                                     # static checks + all tests + browser tests (~3 min)
   ```
   If anything is red, do not ship. Explain the failure to the owner in plain words.
   The browser tests load the real Tailwind/Chart.js CDNs, so they need internet access; a CDN
   outage can turn them red without any change in the repo (re-run before concluding anything).
4. **Never weaken a test to make it pass.** If a test fails after your change, either your
   change broke something (fix the change), or the owner asked for a behavior change (then
   update that specific test, and say so in the commit message and to the owner).
5. **Never use real club data in tests.** `data/latest.json` contains real members' names.
   Tests use fabricated players (`test/factories/players.js`). Don't copy real names, records
   or scores into tests or fixtures.

## 2. What the tests do (in one paragraph)

The tests load the **unchanged** `index.html` into a simulated browser (jsdom) and call the
app's own functions: `generateRound()`, `submitScore()`, `startPlayoffs()`, and so on. Each
routine run plays 55 generated synthetic club nights and brackets in its property tests (always the same ones — fixed
seed; random arrivals, departures, scores) plus fixed scenarios, and checks rules such as
"nobody plays two matches at once", "sit-outs are fair", "partners don't repeat when avoidable",
"ranking points are applied exactly once", and "export → import keeps everything (in memory)".
The weekly stress run tries 150 *new* random cases per rule. A few Playwright tests do the same
in real Chrome. A `test/selftest/` folder tests the test machinery itself (that failures are
classified correctly, that every random case can be replayed alone, and that tests can't leak
state into each other). See [TESTING.md](TESTING.md) for details.

## 3. Reading results

| You see | It means | Do |
|---|---|---|
| All green | The checks passed for the scenarios they exercise. It does **not** prove nothing changed: see "Known gaps" in TESTING.md (multi-event play, corrections, real downloads…) | Ship after a quick manual look at anything your change touched that isn't covered |
| A `[contract]`, `[char]` or property test red | Your change altered existing behavior | Undo or fix the change, unless the owner asked for exactly that behavior change |
| `DISCREPANCY NO LONGER REPRODUCES` | You changed behavior that the audit flagged as a possible bug | Good if intended. Update docs/AUDIT.md and turn the `discrepancy(...)` into a normal `it(...)` asserting the new, approved behavior |
| `UNEXPECTED FAILURE` inside a `[DISC-xx]` test | The test failed somewhere *other* than its documented checkpoint: a setup step broke, something crashed, or an app function was renamed or removed. **This is not the known finding** | Read the message (it says which). Fix the cause. Do not delete the test |
| `CHECKPOINT NEVER REACHED` | The scenario no longer reaches the situation it documents | Your change altered the steps leading there; investigate |
| `UNEXPECTED PAGE ERRORS` | The app threw or logged an error during the test | Treat as a real bug in your change |
| `ISOLATION: … window(s) were left open` | A test you wrote didn't close a window it booted | Close it (see TESTING.md tips) |
| A `selftest/` test red | The test machinery itself is broken — other results can't be trusted | Fix this first |
| Red in the "Known discrepancies" CI job only | Expected. That job lists open findings | Nothing to do |
| Red in the weekly "Stress" workflow | A rule failed on a new random case, a case ran out of time, or fewer cases ran than requested | Open the run's summary and the `stress-scenarios` artifact; replay with `npm run replay -- <fixture>` (TESTING.md). Report it to the owner. Don't auto-fix rules |
| Yellow warning "DISC-15 reproduced by exploration" in Stress | A new example of the already-known partner-rotation finding | Nothing urgent; the fixture is in the artifact if the owner wants it |

## 4. Common tasks

**You changed something and want a test for it.** Copy the example in TESTING.md
("Writing a new test"). Use `useApp()` and the driver `d` (`d.addPlayers`,
`d.createTournament`, `d.generateRound`, `d.playRound`, `d.startPlayoffs`, …). Label it
`[contract]` if the owner confirmed the rule, `[char]` if you're just pinning current behavior.

**You renamed or removed an app function.** Tests call functions by their global names
(`app.call('computeStandings', t)`). Keep the old name working: an alias like
`function oldName(...a){ return newName(...a); }` is fine. Otherwise update the tests in the
same change and run everything.

**The owner reports a bug.** First write a test that reproduces it, with fabricated data.
Then fix it. The test proves the fix and stops the bug coming back; put it in
`test/regression/`.

**The owner approves fixing an audit finding (DISC-xx).** Make the smallest change that fixes
it. The matching `[DISC-xx]` test will report "NO LONGER REPRODUCES". Convert it to a normal
test, update the AUDIT.md row to "Fixed in vX.YY", and run `npm run ci`.

**You bumped the version.** README "Versioning" lists four places. `npm run check` fails if
`APP_VERSION`, the build comment, the `lcfc-build` meta and the `<title>` disagree.

**You're uploading a new `data/latest.json`.** `npm run check` validates its shape: a bad
file can stop the app from loading on members' phones (AUDIT DISC-08).

## 5. Things that look odd but are intentional (don't "fix" them)

- One big HTML file; data in browser localStorage; members load a JSON file from GitHub Pages.
- Operator PIN is a light gate (the README says so).
- Ranking changes only from playoffs/brackets, never from ranking rounds alone. Sandbox events never count.
- Sit-outs = players mod 4. Tables don't limit who plays (extra matches wait "on deck").
- New arrivals don't sit out before they've played once.
- Monster playoffs are always best-of-3; tiered partners are 1+(n/2+1), 2+(n/2+2), ….
- Rendering functions also assign tables. The tests rely on the real rendering for that reason.

## 6. Open findings that need the owner's decision

See [AUDIT.md](AUDIT.md), section A. The most important ones for club nights:
- Correcting a playoff score after later matches were played can still leave a player
  double-booked in rare brackets (DISC-01, partially resolved in v7.34). DISC-02…06 (podium
  duplicates, "Edit score" wiping Bo3 results, same-winner fixes, ranking after corrections,
  unsaved imports) were resolved in v7.34 and are now regression tests (AUDIT.md section A2).
- Finishing any bracket rebuilds every player's club points from stored event deltas, so points
  not backed by a retained delta (e.g. from a deleted event) disappear (DISC-17, owner-accepted
  for now).
- Turning Operator mode off and reloading replaces local data with the club file (R-01).
- In a single-elimination event with a bronze match, the bronze-match loser is ranked last of
  the non-podium players, behind the quarter-final losers (DISC-16, a rules question).

Until the owner decides, a safe operating tip for club nights: **export a backup before
correcting playoff scores.**

## 7. Evaluating a new upstream release (rolling branch)

Rolling branch: **`engineering/upstream-current`** on the fork (`origin`). One normal commit per
evaluated upstream release; never force-push, rebase, or merge it into `main`. Older
`engineering/upstream-v7xx-evaluation` / `v7xx-*maintenance` branches are history: keep them.
`upstream` has push disabled; push only to `origin`.

```bash
git switch engineering/upstream-current && git pull --ff-only origin engineering/upstream-current
git fetch upstream
PIN=$(git rev-parse upstream/main)            # pin once; ignore later upstream pushes
git show "$PIN:index.html" | grep -m1 LCFC_MANAGER_BUILD   # version
git show "$PIN:index.html" > index.html        # import the app file only (keep data/, tests)
[ "$(git show "$PIN:index.html" | sha256sum)" = "$(sha256sum < index.html)" ] && echo BYTE-IDENTICAL
git diff --quiet -- index.html && echo "unchanged since last evaluation: stop, no commit"
git commit -m "Evaluate upstream vX.YY: import index.html from $PIN" -- index.html
npm run check
npm test -- --no-file-parallelism              # unrestricted parallelism has hit Node OOM
npx playwright test --workers=1
node scripts/stress.mjs --runs 3 --seed 20261108   # same bounded run as CI
npm run test:discrepancies -- --no-file-parallelism  # red = still-open findings (expected)
git push origin engineering/upstream-current   # ordinary push, even if tests failed
gh run list --branch engineering/upstream-current --limit 1   # then: gh run watch <id>
```

A failed evaluation is a valid result: push it and report it. To investigate, branch off the
evaluation commit (`git switch -c engineering/investigate-vX.YY <sha>`) or check it out
detached; fix tests or report app bugs there, never by amending the evaluation commit. If the
next release fixes things, it simply lands as the next commit on the rolling branch.

## 8. Map of the repo

```
index.html                 the app (unchanged by the test work)
data/latest.json           published club file (real data — never use in tests)
docs/ARCHITECTURE.md       how the app behaves today (baseline)
docs/AUDIT.md              findings, severity, owner decisions needed
docs/TESTING.md            running, reading and writing tests
docs/REFACTORING-ROADMAP.md  safe, staged improvement plan
docs/REVIEW-REMEDIATION.md  how the independent review's findings were fixed, with evidence
test/                      all tests (see TESTING.md for layout); test/selftest = tests of the tests
scripts/check-syntax.mjs   static checks (npm run check)
scripts/stress.mjs         randomized exploration with verified run counts (stress.yml)
scripts/replay.mjs         replay one saved scenario: npm run replay -- <fixture.json>
scripts/serve.mjs          local preview: npm run serve → http://localhost:4173/
.github/workflows/         ci.yml (every push/PR; also calls stress.yml with 3 cases),
                           stress.yml (weekly/manual exploration, 150 cases per property)
```

GitHub Pages serves the repo root. The extra folders (`docs/`, `test/`, `scripts/`) are
harmless there, but they are publicly visible like everything else in the repo.
