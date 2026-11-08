/**
 * Test harness: boots the REAL production index.html inside jsdom.
 *
 * Why this approach: the whole app is one inline <script> of top-level
 * functions sharing a global `state`. Rather than copy or refactor production
 * code for testing, we execute the shipped file unchanged and reach its
 * functions and `let`/`const` globals through `window.eval` (indirect eval runs
 * at global scope, so it can see top-level lexical bindings like `state`).
 *
 * What is stubbed (and only this):
 *   - CDN globals: `tailwind` (config sink) and `Chart` (no-op class)
 *   - `fetch` for data/latest.json (default: 404, i.e. no club snapshot)
 *   - `prompt` / `confirm` / `alert` (scripted answers; default confirm=true)
 *   - `Math.random` -> seeded PRNG so every draw is reproducible
 *   - speechSynthesis / AudioContext / matchMedia (absent in jsdom)
 *
 * Every test gets a fresh window (fresh `state`, fresh localStorage).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { mulberry32 } from '../factories/random.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
const HTML = readFileSync(INDEX_HTML_PATH, 'utf8');

export const STORAGE_KEY = 'foosmanager_v1';
export const OPERATOR_MODE_KEY = 'lcfc_operator_mode_v1';

function makeFetch(snapshot) {
  return async function fetchStub(url) {
    const u = String(url);
    if (!u.includes('data/latest.json')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (snapshot === 'network-error') throw new TypeError('Failed to fetch');
    if (snapshot == null || snapshot === 404) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (typeof snapshot === 'number') {
      return { ok: false, status: snapshot, json: async () => ({}) };
    }
    const body = JSON.stringify(snapshot);
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.seed=1]              PRNG seed for Math.random
 * @param {boolean} [opts.operator=true]      start in operator mode (snapshot not applied)
 * @param {object} [opts.data]                {players, tournaments} preloaded into localStorage
 * @param {object} [opts.localStorage]        extra raw localStorage entries
 * @param {object|number|string} [opts.snapshot] data/latest.json response (object | 404 | 500 | 'network-error')
 * @param {string} [opts.url]                 page URL (e.g. add ?local=1)
 */
export async function loadApp(opts = {}) {
  const {
    seed = 1,
    operator = true,
    data = null,
    localStorage: extraStorage = {},
    snapshot = 404,
    url = 'http://lcfc.test/index.html',
  } = opts;

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    // jsdom "not implemented" noise (canvas, scrollTo, etc.) is not an app error
    if (/Not implemented/i.test(e.message)) return;
    errors.push(e);
  });
  virtualConsole.on('error', (...args) => errors.push(new Error(args.map(String).join(' '))));

  const dialogs = { confirm: [], prompt: [], log: [] };

  const dom = new JSDOM(HTML, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.Math.random = mulberry32(seed);
      window.tailwind = { config: {} };
      window.Chart = class ChartStub {
        constructor() { this.data = {}; this.options = {}; }
        destroy() {}
        update() {}
      };
      // The app sets Chart.defaults.color / .font at render time.
      window.Chart.defaults = { color: '', font: {}, plugins: { legend: { labels: {} }, tooltip: {} } };
      window.fetch = makeFetch(snapshot);
      window.matchMedia = window.matchMedia || (() => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      }));
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.confirm = (msg) => {
        dialogs.log.push({ type: 'confirm', msg });
        return dialogs.confirm.length ? dialogs.confirm.shift() : true;
      };
      window.prompt = (msg) => {
        dialogs.log.push({ type: 'prompt', msg });
        return dialogs.prompt.length ? dialogs.prompt.shift() : null;
      };
      window.alert = (msg) => { dialogs.log.push({ type: 'alert', msg }); };

      const ls = window.localStorage;
      if (operator) ls.setItem(OPERATOR_MODE_KEY, '1');
      if (data) ls.setItem(STORAGE_KEY, JSON.stringify(data));
      for (const [k, v] of Object.entries(extraStorage)) ls.setItem(k, v);
    },
  });

  const { window } = dom;
  // Let the async snapshot boot (fetch -> json -> apply) settle.
  await settle(window);

  const app = {
    dom,
    window,
    errors,
    dialogs,
    /** Evaluate code at the app's global scope. */
    eval: (code) => window.eval(code),
    /** Call a top-level production function by name. */
    call: (name, ...args) => {
      const fn = window.eval(name);
      if (typeof fn !== 'function') throw new Error(`${name} is not a function in index.html`);
      return fn(...args);
    },
    get state() { return window.eval('state'); },
    /** Move a plain value into the window realm (so Array.isArray etc. behave natively). */
    toWindow: (value) => window.JSON.parse(JSON.stringify(value)),
    /** Replace players/tournaments in memory (does not save). */
    setData: ({ players = [], tournaments = [] }) => {
      const s = window.eval('state');
      s.players = window.JSON.parse(JSON.stringify(players));
      s.tournaments = window.JSON.parse(JSON.stringify(tournaments));
    },
    /** Snapshot of persisted localStorage blob (parsed). */
    stored: () => {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    /** Deep plain copy of current in-memory data, safe for assertions. */
    snapshot: () => JSON.parse(JSON.stringify({
      players: window.eval('state.players'),
      tournaments: window.eval('state.tournaments'),
    })),
    /** Toasts currently shown (most recent last). */
    toasts: () => [...window.document.querySelectorAll('#toast-container > *')].map((e) => e.textContent),
    openTournament: (id) => {
      window.eval('state').currentTournamentId = id;
    },
    /** Re-seed Math.random inside the app (for per-run reproducibility). */
    reseed: (s) => { window.Math.random = mulberry32(s); },
    /** Clear club data in memory + storage without rebooting (fast property runs). */
    reset: ({ seed: s } = {}) => {
      const st = window.eval('state');
      st.players = window.JSON.parse('[]');
      st.tournaments = window.JSON.parse('[]');
      st.currentTournamentId = null;
      delete st._fairLastEventId;
      window.localStorage.removeItem(STORAGE_KEY);
      window.document.getElementById('toast-container').innerHTML = '';
      dialogs.confirm.length = 0; dialogs.prompt.length = 0; dialogs.log.length = 0;
      errors.length = 0;
      if (s != null) window.Math.random = mulberry32(s);
    },
    close: () => window.close(),
  };
  return app;
}

/** Wait for pending microtasks/timeouts inside the window to flush. */
export async function settle(window, rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => window.setTimeout(r, 0));
  }
}
