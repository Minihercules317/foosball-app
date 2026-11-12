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
 *
 * Home (v7.37): a finished event's card is collapsed by default and shows only the
 * title and podium; it is checked collapsed and, after clicking its chevron,
 * expanded. Neither state shows every player, so Home expects the title, the podium
 * pairs and the names in the recap — what the app actually renders — not the field.
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

const collapseWs = (s) => s.replace(/\s+/g, ' ').trim();
/**
 * Home podium cells show "A\nB" (a pair) and fitHomeChampionLabels re-splits the
 * label on " + " for line breaks, so a name like "Plus + Sign" is displayed as
 * "Plus⏎Sign". Compare podium text modulo that documented line formatting.
 */
const podiumText = (s) => collapseWs(s.replace(/ \+ |\n/g, ' '));

function homeCard(doc, t) {
  const card = doc.querySelector(`#tournament-list [data-home-event="${t.id}"]`);
  if (!card) throw new Error(`home: no card for event ${t.id}`);
  return card;
}

/**
 * Render Home via `act`, then check it TWICE: synchronously, before the next frame's
 * fitHomeChampionLabels rewrites podium cells via textContent (which would mask
 * markup injected by renderHome itself), and again by the caller after settling.
 */
async function renderedHome(app, act, where) {
  const doc = app.window.document;
  const before = injected(doc);
  act();
  expect(injected(doc), `${where}: markup injected by renderHome (before podium fit)`).toBe(before);
  const cells = [...doc.querySelectorAll('#tournament-list .home-champ-name')];
  expect(cells.length, `${where}: podium rendered`).toBeGreaterThan(0);
  for (const cell of cells) {
    expect(cell.children.length, `${where}: podium cell ${JSON.stringify(cell.title)} contains elements`).toBe(0);
    expect(podiumText(cell.textContent), `${where}: podium ${JSON.stringify(cell.title)} rendered as text (before fit)`).toBe(podiumText(cell.title));
  }
  await settle(app.window, 3); // podium labels are fitted on the next frame
}

/**
 * State-specific Home checks. Collapsed: title + podium only. Expanded: title,
 * recap, podium and "Open event". Every adversarial name the card displays must be
 * literal text; the names shown are taken from what the app renders (the podium
 * and the recap), not assumed to be the whole field.
 */
function checkHomeCard(app, d, t, { expanded }) {
  const doc = app.window.document;
  const card = homeCard(doc, t);
  const where = `home (${expanded ? 'expanded' : 'collapsed'})`;
  expect(isVisible(card), `${where}: card visible`).toBe(true);
  expect(card.dataset.expanded, `${where}: data-expanded`).toBe(String(expanded));
  const chevron = card.querySelector('button[aria-expanded]');
  expect(chevron?.getAttribute('aria-expanded'), `${where}: chevron state`).toBe(String(expanded));
  expect(card.querySelector('h3')?.textContent, `${where}: title is the literal event name`).toBe(EVENT_NAME);

  // Podium: three places, each a Monster DYP pair of this event's players, as text.
  const eventNames = new Set(t.playerIds.map((id) => d.player(id).name));
  const cells = [...card.querySelectorAll('.home-champ-name')];
  expect(cells.map((c) => c.previousElementSibling?.textContent), `${where}: podium places`).toEqual(['1st', '2nd', '3rd']);
  const podiumNames = [];
  for (const cell of cells) {
    const pair = cell.getAttribute('title').split(' + ');
    // "Plus + Sign" contains the separator: re-join greedily against real names.
    const names = [];
    for (let i = 0; i < pair.length; i++) {
      const two = i + 1 < pair.length ? `${pair[i]} + ${pair[i + 1]}` : null;
      if (two && eventNames.has(two)) { names.push(two); i++; } else names.push(pair[i]);
    }
    expect(names.every((n) => eventNames.has(n)), `${where}: podium cell ${JSON.stringify(cell.title)} names this event's players`).toBe(true);
    expect(names, `${where}: podium cell is a pair`).toHaveLength(2);
    expect(cell.children.length, `${where}: podium cell ${JSON.stringify(cell.title)} contains elements`).toBe(0);
    expect(podiumText(cell.textContent), `${where}: podium ${JSON.stringify(cell.title)} rendered as text`).toBe(podiumText(names.join('\n')));
    podiumNames.push(...names);
  }
  expect(new Set(podiumNames).size, `${where}: podium shows six distinct players`).toBe(6);
  expect(podiumNames.some((n) => n.includes('<')), `${where}: podium includes an HTML-shaped name (non-vacuous)`).toBe(true);

  const recap = card.querySelector('p.leading-snug');
  const openBtn = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open event');
  if (!expanded) {
    expect(recap, `${where}: recap hidden`).toBeNull();
    expect(openBtn, `${where}: "Open event" hidden`).toBeUndefined();
    return;
  }
  expect(openBtn, `${where}: "Open event" shown`).toBeTruthy();
  // The recap is generated text; it must appear verbatim (escaped), whatever names it mentions.
  const expectedRecap = app.call('generateEventRecap', t);
  expect(recap?.textContent, `${where}: recap rendered as literal text`).toBe(expectedRecap);
  const recapNames = ADVERSARIAL_NAMES.concat(BOLD).filter((n) => expectedRecap.includes(n));
  expect(recapNames.some((n) => n.includes('<')), `${where}: recap mentions an HTML-shaped name (non-vacuous)`).toBe(true);
  for (const n of recapNames) expect(recap.textContent, `${where}: recap shows ${JSON.stringify(n)} as text`).toContain(n);
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
    // v7.37: a finished event's Home card is collapsed by default (title + podium only);
    // its chevron expands it (recap, stats, podium, "Open event"). Both states are covered.
    { label: 'home (collapsed)', panel: 'view-home', mustShow: [EVENT_NAME],
      show: async () => { await renderedHome(app, () => app.call('showView', 'home'), 'home (collapsed)'); },
      check: () => checkHomeCard(app, d, t, { expanded: false }) },
    { label: 'home (expanded)', panel: 'view-home', mustShow: [EVENT_NAME],
      show: async () => { await renderedHome(app, () => homeCard(doc, t).querySelector('button[aria-expanded]').click(), 'home (expanded)'); },
      check: () => checkHomeCard(app, d, t, { expanded: true }) },
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
    view.check?.();
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
    // 14 views; Home is checked in both its collapsed and expanded states.
    expect(covered).toHaveLength(15);
  });
});
