/**
 * Display-name escaping: player / tournament names come from operator input,
 * imported files and data/latest.json. They must render as text everywhere.
 * (Ids are a separate, known gap — see test/discrepancies DISC-10.)
 */
import { describe, it, expect } from 'vitest';
import { useApp } from '../harness/useApp.js';
import { ADVERSARIAL_NAMES } from '../factories/players.js';

const ctx = useApp();

const injected = (doc) => doc.querySelectorAll('img[onerror], [data-pwn], script:not([src])').length;

describe('display names are escaped in every major view', () => {
  it('[contract] adversarial player and tournament names never become markup', () => {
    const { app, d } = ctx;
    const doc = app.window.document;
    const baseline = injected(doc); // the app's own inline scripts
    const ids = d.addPlayers(8);
    ADVERSARIAL_NAMES.forEach((name, i) => { d.player(ids[i]).name = name; });
    d.player(ids[6]).name = '<b data-pwn="1">bold</b>';
    const t = d.createTournament({ type: 'monster', name: '<img src=x onerror="window.__xss=2"> Night' });
    d.addToEvent(t, ids);
    for (let i = 0; i < 2; i++) { d.generateRound(t); d.playRound(t); }
    d.startPlayoffs(t);
    d.playBracketToCompletion(t);

    const views = [
      () => app.call('renderHome'),
      () => app.call('renderPlayers'),
      () => { app.call('showView', 'stats'); app.call('renderStats'); },
      () => { for (const tab of ['ranking', 'partners', 'crazy', 'charts', 'dna']) { try { app.call('setStatsTab', tab); } catch (e) { /* unknown tab id */ } } },
      () => { d.open(t); for (const tab of ['players', 'matches', 'standings', 'bracket']) { app.state.currentTab = tab; app.call('renderTournament'); } },
      () => app.call('openSpectator', t.id),
      () => app.call('openPlayerProfile', ids[1]),
    ];
    for (const render of views) {
      render();
      expect(injected(doc), `markup injected after ${render.toString()}`).toBe(baseline);
    }
    expect(app.window.__xss).toBeUndefined();
    expect(app.errors.map(String)).toEqual([]);
  });
});
