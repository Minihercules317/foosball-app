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
 *   - canvas getContext → inert 2D context (jsdom has no canvas implementation)
 *
 * Isolation: every test (test/harness/useApp.js) and every generated property case
 * (test/harness/scenario.js) gets its OWN freshly booted window — fresh `state`,
 * settings, localStorage/sessionStorage, timers, listeners and top-level globals.
 * There is deliberately no in-place "reset": the app keeps state in dozens of
 * top-level bindings, timers and listeners, and a partial reset was shown to leak
 * settings and substituted functions between cases (independent review F3).
 * Every window is registered while open; test/harness/setup.js fails any test that
 * leaves one open, and test/selftest/isolation.test.js proves contamination does
 * not leak.
 *
 * Test-only hooks (never touch index.html on disk):
 *   - `html` option: boot an in-memory MUTATED copy (see mutateHtml) — used by
 *     mutation probes that prove a test can tell correct from wrong behavior.
 *   - LCFC_FAULT env var: inject a named fault after boot (test/harness/faults.js) —
 *     used by self-tests that prove broken behavior turns the suite red.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { mulberry32 } from '../factories/random.js';
import { applyFaults } from './faults.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
export const PRODUCTION_HTML = readFileSync(INDEX_HTML_PATH, 'utf8');

/** Windows booted and not yet closed (see test/harness/setup.js). */
const OPEN_APPS = new Set();
export const openApps = () => [...OPEN_APPS];

/**
 * Return an in-memory copy of index.html with exact text replacements applied.
 * Each `find` must occur EXACTLY once, so a mutation can never silently miss
 * (which would make a mutation probe pass vacuously).
 * @param {Array<[string, string]>} pairs
 */
export function mutateHtml(pairs, html = PRODUCTION_HTML) {
  let out = html;
  for (const [find, replace] of pairs) {
    const n = out.split(find).length - 1;
    if (n !== 1) throw new Error(`mutateHtml: expected exactly 1 occurrence, found ${n}: ${find.slice(0, 80)}`);
    out = out.replace(find, () => replace);
  }
  return out;
}

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
 * @param {string} [opts.html]                in-memory page source (mutation probes); default: index.html
 */
export async function loadApp(opts = {}) {
  const {
    seed = 1,
    operator = true,
    data = null,
    localStorage: extraStorage = {},
    snapshot = 404,
    url = 'http://lcfc.test/index.html',
    html = PRODUCTION_HTML,
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

  const dom = new JSDOM(html, {
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
      // jsdom has no canvas: getContext() returns null, so the app's own canvas
      // drawing (e.g. clearing an empty chart) would throw where a browser works.
      // Provide an inert 2D context (every method a no-op) — like the Chart stub.
      window.HTMLCanvasElement.prototype.getContext = function getContext() { return inert2dContext(this); };
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
  let closed = false;
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
    get closed() { return closed; },
    /** Close the window: stops its timers and drops its listeners and storage. */
    close: () => {
      if (closed) return;
      closed = true;
      OPEN_APPS.delete(app);
      window.close();
    },
  };
  OPEN_APPS.add(app);
  applyFaults(app);
  return app;
}

/** A 2D-context stand-in: methods are no-ops returning further stand-ins; measureText → {width:0}. */
function inert2dContext(canvas) {
  const values = { canvas };
  const fn = () => new Proxy(function () {}, handler);
  const handler = {
    get(target, prop) {
      if (prop in values) return values[prop];
      if (prop === 'width' || prop === 'height' || prop === 'actualBoundingBoxAscent') return 0;
      if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
      return fn();
    },
    set(target, prop, v) { values[prop] = v; return true; },
    apply() { return fn(); },
  };
  return new Proxy({}, handler);
}

/** Wait for pending microtasks/timeouts inside the window to flush. */
export async function settle(window, rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => window.setTimeout(r, 0));
  }
}
