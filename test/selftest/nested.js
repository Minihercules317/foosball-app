/**
 * Run Vitest in a CHILD PROCESS and return each test's outcome. Self-tests use
 * this to prove that a test FAILS (with which message) under a controlled fault,
 * without the parent run going red. The child gets a clean environment: CI /
 * GitHub variables are removed so deliberately failing probes never produce
 * annotations in the real CI run.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
let counter = 0;

/**
 * @param {object} o
 * @param {string[]} o.files          test files (repo-relative)
 * @param {object}  [o.env]           extra env (e.g. { LCFC_FAULT: 'noop-submitScore' })
 * @param {string}  [o.filter]        -t name filter
 * @param {string}  [o.config]        vitest config (default: the repo config)
 * @returns {Promise<{code:number, stdout:string, tests:Map<string,{status:string, message:string}>}>}
 *   stdout: the child's default-reporter output (Vitest's JSON report omits timeout text)
 */
export function runVitest({ files, env = {}, filter, config = 'vitest.config.js' }) {
  const outDir = path.join(ROOT, 'test-results', 'selftest');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `nested-${process.pid}-${Date.now()}-${counter++}.json`);
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !/^(VITEST|CI$|GITHUB_|TEST$|NODE_ENV$|LCFC_FAULT$|STRICT$|EXPLORE$|FC_|PROP_|SHRINK$|SCENARIO_FILE$)/.test(k)));
  const args = [VITEST, 'run', '--config', config, '--reporter=json', '--reporter=default', `--outputFile.json=${outFile}`, ...files];
  if (filter) args.push('-t', filter);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...childEnv, NO_COLOR: '1', FORCE_COLOR: '0', ...env } });
    let stdout = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stdout += b; });
    child.on('error', reject);
    child.on('close', (code) => {
      let json;
      try { json = JSON.parse(readFileSync(outFile, 'utf8')); } catch (e) {
        reject(new Error(`nested vitest produced no JSON report (exit ${code}):\n${stdout.slice(-3000)}`)); return;
      }
      rmSync(outFile, { force: true });
      const tests = new Map();
      for (const file of json.testResults) {
        for (const a of file.assertionResults) {
          tests.set(a.title, { status: a.status, message: (a.failureMessages || []).join('\n'), fullName: a.fullName });
        }
        if (file.status === 'failed' && !file.assertionResults.length) tests.set(`<file ${file.name}>`, { status: 'failed', message: file.message || '' });
      }
      resolve({ code, stdout, tests });
    });
  });
}
