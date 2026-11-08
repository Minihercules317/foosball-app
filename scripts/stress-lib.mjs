// Pure verification logic for scripts/stress.mjs (unit-tested in test/selftest/stress.test.js).

/** Properties the stress run must execute, and whether finding a counterexample is a KNOWN discrepancy. */
export const STRESS_PROPERTIES = [
  { id: 'bracket-clean', known: false },
  { id: 'partners-repeat-free', known: false },
  { id: 'ranking-round-structure', known: false },
  { id: 'ranking-round-steady-sit-spread', known: false },
  { id: 'DISC-15-exploration', known: true }, // exploratory(): a DISC-15 instance is recorded and the run continues
];
export const STRESS_FILES = ['test/properties', 'test/discrepancies/partners.test.js'];

/**
 * @param {object} o
 * @param {number} o.vitestExit   exit code of the vitest run
 * @param {Record<string, object>} o.records  property-run records by id (test-results/property-runs)
 * @param {number} o.requested    PROP_RUNS
 * @param {{id:string, known:boolean}[]} [o.expected]
 * @returns {{ok:boolean, problems:string[], findings:string[], rows:object[]}}
 */
export function verifyStress({ vitestExit, records, requested, expected = STRESS_PROPERTIES }) {
  const problems = [];
  const findings = [];
  const rows = [];
  if (vitestExit !== 0) problems.push(`vitest exited with code ${vitestExit} (a property or exploration failed unexpectedly — see the log and the scenario fixtures)`);
  for (const { id, known } of expected) {
    const r = records[id];
    if (!r) { problems.push(`${id}: no run record — the property did not run (skipped, filtered out, or crashed before finishing)`); continue; }
    rows.push(r);
    if (r.requested !== requested) problems.push(`${id}: requested ${r.requested} cases but the stress run asked for ${requested} (PROP_RUNS not honored)`);
    // Every property — known-discrepancy ones included — must execute the full workload.
    // A known observation is recorded by checkProperty() and the run continues; a
    // `counterexample` record means fast-check STOPPED, so the workload is incomplete.
    if (r.outcome === 'passed') {
      if (r.executed !== requested) problems.push(`${id}: executed ${r.executed} of ${requested} requested cases`);
      for (const f of r.knownFindings || []) {
        if (known) findings.push(`${id}: known discrepancy reproduced on case ${f.caseNumber} of ${r.executed} (exploration continued) — fixture ${f.fixture}`);
        else problems.push(`${id}: reported a known-discrepancy finding but is not a known-discrepancy property — fixture ${f.fixture}`);
      }
    } else {
      const why = r.outcome === 'counterexample' && known ? ' — fast-check stopped early, so the requested workload did NOT complete (a known discrepancy does not waive the run count)' : '';
      problems.push(`${id}: ${r.outcome} after ${r.executed} of ${requested} case(s)${r.fixture ? ` — fixture ${r.fixture}` : ''}${why}`);
    }
  }
  return { ok: problems.length === 0, problems, findings, rows };
}

export function summaryMarkdown({ requested, seed, result }) {
  const lines = [
    `### Stress exploration — ${requested} case(s) per property, seed ${seed ?? 'random per property'}`,
    '',
    '| Property | Outcome | fast-check seed | Executed / requested | Slowest case | Total |',
    '|---|---|---|---|---|---|',
    ...result.rows.map((r) => `| ${r.property} | ${r.outcome}${r.knownFindings?.length ? ` (${r.knownFindings.length} known finding(s))` : ''} | ${r.fcSeed} | ${r.executed} / ${r.requested} | ${(r.slowestCaseMs / 1000).toFixed(1)} s | ${Math.round(r.durationMs / 1000)} s |`),
    '',
    ...result.findings.map((f) => `- ⚠️ ${f}`),
    ...result.problems.map((p) => `- ❌ ${p}`),
    result.ok ? '\n**Result: passed** (scenario fixtures for any finding are in the `stress-scenarios` artifact)' : '\n**Result: FAILED**',
  ];
  return lines.join('\n') + '\n';
}
