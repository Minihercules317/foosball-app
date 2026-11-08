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
   npm ci            # first time only
   npm run ci        # static checks + all tests + browser tests (~2 min)
   ```
   If anything is red, do not ship. Explain the failure to the owner in plain words.
4. **Never weaken a test to make it pass.** If a test fails after your change, either your
   change broke something (fix the change), or the owner asked for a behavior change (then
   update that specific test, and say so in the commit message and to the owner).
5. **Never use real club data in tests.** `data/latest.json` contains real members' names.
   Tests use fabricated players (`test/factories/players.js`). Don't copy real names, records
   or scores into tests or fixtures.

## 2. What the tests do (in one paragraph)

The tests load the **unchanged** `index.html` into a simulated browser (jsdom) and call the
app's own functions: `generateRound()`, `submitScore()`, `startPlayoffs()`, and so on. They
play thousands of synthetic club nights (random arrivals, departures, scores) and check
rules such as "nobody plays two matches at once", "sit-outs are fair", "partners don't repeat
when avoidable", "ranking points are applied exactly once", and "export → import keeps
everything". A few Playwright tests do the same in real Chrome. See
[TESTING.md](TESTING.md) for details.

## 3. Reading results

| You see | It means | Do |
|---|---|---|
| All green | Nothing covered by tests changed | Ship (after a quick manual look) |
| A `[contract]`, `[char]` or property test red | Your change altered existing behavior | Undo or fix the change, unless the owner asked for exactly that behavior change |
| `DISCREPANCY NO LONGER REPRODUCES` | You changed behavior that the audit flagged as a possible bug | Good if intended. Update docs/AUDIT.md and turn the `discrepancy(...)` into a normal `it(...)` asserting the new, approved behavior |
| `UNEXPECTED ERROR` inside a `[DISC-xx]` test | The test crashed: a harness problem, or an app function was renamed or removed | Fix the cause. Do not delete the test |
| Red in the "Known discrepancies" CI job only | Expected. That job lists open findings | Nothing to do |
| Red in the weekly "Stress" workflow | A new random scenario broke an invariant | Reproduce with the printed seed (TESTING.md). Report it to the owner. Don't auto-fix rules |

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
- Correcting a playoff score after later matches were played can corrupt the bracket (DISC-01…05).
- Opening "Edit score" on a finished best-of-3 match erases it, even if you cancel (DISC-03).
- Imports are not saved until something else saves (DISC-06).
- Turning Operator mode off and reloading replaces local data with the club file (R-01).

Until the owner decides, a safe operating tip for club nights: **export a backup before
correcting playoff scores, and avoid opening "Edit score" on finished best-of-3 matches.**

## 7. Map of the repo

```
index.html                 the app (unchanged by the test work)
data/latest.json           published club file (real data — never use in tests)
docs/ARCHITECTURE.md       how the app behaves today (baseline)
docs/AUDIT.md              findings, severity, owner decisions needed
docs/TESTING.md            running, reading and writing tests
docs/REFACTORING-ROADMAP.md  safe, staged improvement plan
test/                      all tests (see TESTING.md for layout)
scripts/check-syntax.mjs   static checks (npm run check)
scripts/serve.mjs          local preview: npm run serve → http://localhost:4173/
.github/workflows/         ci.yml (every push/PR), stress.yml (weekly/manual exploration)
```

GitHub Pages serves the repo root. The extra folders (`docs/`, `test/`, `scripts/`) are
harmless there, but they are publicly visible like everything else in the repo.
