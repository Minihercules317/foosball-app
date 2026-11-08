/**
 * Display-name escaping: player / tournament names come from operator input,
 * imported files and data/latest.json. They must render as text in the views
 * exercised here. (Ids are a separate, known gap — see test/discrepancies DISC-10.)
 *
 * Every view is opened through the app's own navigation with its REAL id
 * (stats tabs: index.html setStatsTab's list; tournament tabs: the .tab-btn
 * buttons). Nothing is caught: a view that throws fails the test. For each view
 * the test proves it actually rendered — its panel is visible and contains the
 * adversarial names as literal TEXT — before checking that no markup was
 * injected. (Review F4: the previous version used wrong tab ids and swallowed
 * exceptions, so a crashing view still passed.)
 */
import { describe, it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { settle } from '../harness/loadApp.js';
import { ADVERSARIAL_NAMES } from '../factories/players.js';

const ctx = useApp();

const BOLD = '<b data-pwn="1">bold</b>';
const EVENT_NAME = '<img src=x onerror="window.__xss=2"> Night';
const injected = (doc) => doc.querySelectorAll('img[onerror], [data-pwn], script:not([src])').length;

/** Visible = present and no ancestor carries the `hidden` class. */
function isVisible(el) {
  for (let e = el; e; e = e.parentElement) if (e.classList?.contains('hidden')) return false;
  return !!el;
}

/** The views covered, with the panel that must be visible and text that must appear in it. */
function securityViews(app, d, t, ids) {
  const doc = app.window.document;
  const tabBtn = (tab) => {
    const btn = doc.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (!btn) throw new Error(`tournament tab button "${tab}" not found`);
    return btn;
  };
  const playerNames = ADVERSARIAL_NAMES.map((n) => n.trim());
  const statsTab = (tab, mustShow = playerNames) => ({
    label: `stats tab "${tab}"`, panel: `stats-tab-${tab}`, mustShow,
    show: async () => { app.call('setStatsTab', tab); await settle(app.window, 3); }, // awards draws charts on the next frame
  });
  return [
    { label: 'home', panel: 'view-home', mustShow: [EVENT_NAME, ...playerNames], show: () => app.call('showView', 'home') },
    { label: 'players list', panel: 'view-players', mustShow: [...playerNames, BOLD], show: () => app.call('showView', 'players') },
    { label: 'player profile', panel: 'player-profile-panel', mustShow: [d.player(ids[1]).name], show: () => app.call('openPlayerProfile', ids[1]) },
    { label: 'stats view', panel: 'view-stats', mustShow: playerNames, show: () => app.call('showView', 'stats') },
    statsTab('week'),
    statsTab('career'),
    statsTab('ranking'),
    statsTab('club-dna', [ADVERSARIAL_NAMES[3]]), // Club DNA shows only a few highlighted players
    statsTab('awards', [EVENT_NAME, ...playerNames]),
    ...['players', 'matches', 'standings', 'bracket'].map((tab) => ({
      label: `event tab "${tab}"`, panel: `tab-${tab}`, mustShow: playerNames,
      show: () => { d.open(t); app.call('showView', 'tournament'); app.call('switchTab', tabBtn(tab)); },
    })),
    { label: 'TV board', panel: 'view-spectator', mustShow: [EVENT_NAME, ...playerNames], show: async () => { app.call('openSpectator', t.id); await settle(app.window, 3); } },
  ];
}

/** Build the adversarial club night. */
function adversarialNight(d) {
  const ids = d.addPlayers(8);
  ADVERSARIAL_NAMES.forEach((name, i) => { d.player(ids[i]).name = name; });
  d.player(ids[6]).name = BOLD;
  const t = d.createTournament({ type: 'monster', name: EVENT_NAME });
  d.addToEvent(t, ids);
  for (let i = 0; i < 2; i++) { d.generateRound(t); d.playRound(t); }
  d.startPlayoffs(t);
  d.playBracketToCompletion(t);
  return { t, ids };
}

/** Open every view; throws (never swallows) on the first view that misbehaves. */
async function exerciseViews(app, d) {
  const doc = app.window.document;
  const baseline = injected(doc); // the app's own inline scripts
  const { t, ids } = adversarialNight(d);
  expect(t.status, 'setup: the adversarial night finished').toBe('finished');
  const covered = [];
  for (const view of securityViews(app, d, t, ids)) {
    await view.show();
    const panel = doc.getElementById(view.panel);
    expect(panel, `${view.label}: panel #${view.panel} exists`).toBeTruthy();
    expect(isVisible(panel), `${view.label}: panel #${view.panel} is visible`).toBe(true);
    const text = panel.textContent;
    for (const s of view.mustShow) expect(text, `${view.label}: rendered ${JSON.stringify(s)} as text`).toContain(s);
    expect(injected(doc), `${view.label}: markup injected`).toBe(baseline);
    expect(app.errors.map(String), `${view.label}: page errors`).toEqual([]);
    covered.push(view.label);
  }
  expect(app.window.__xss).toBeUndefined();
  return covered;
}

describe('display names are escaped in every covered view', () => {
  it('[contract] adversarial player and tournament names render as text, never as markup', async () => {
    const covered = await exerciseViews(ctx.app, ctx.d);
    expect(covered).toHaveLength(14);
  });
});
