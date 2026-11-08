/**
 * DISCREPANCIES — persistence, import, data integrity, security.
 * Requires domain-owner review; see docs/AUDIT.md. Expected to fail against the
 * current index.html AT THEIR DECLARED CHECKPOINT (run `npm run test:discrepancies`
 * to see the failures). Windows are booted per test and closed in afterEach.
 */
import { describe, expect, afterEach } from 'vitest';
import { loadApp, STORAGE_KEY } from '../harness/loadApp.js';
import { createDriver, runMonsterNight } from '../factories/driver.js';
import { resetIds } from '../factories/players.js';
import { discrepancy } from '../harness/discrepancy.js';

const opened = [];
async function boot(opts) { const app = await loadApp(opts); opened.push(app); return app; }
afterEach(() => { while (opened.length) opened.pop().close(); resetIds(); });
const pointsOf = (app) => Object.fromEntries(app.state.players.map((p) => [p.id, p.rankingPoints]));

async function clubWithNight(seed = 5) {
  const app = await boot({ seed });
  const d = createDriver(app, { seed });
  const { t, ids } = runMonsterNight(app, d, { players: 10 });
  return { app, d, t, ids };
}

describe('DISC-06 import persistence', () => {
  discrepancy('DISC-06', 'after a successful full replace-import, a reload shows the imported data', { checkpoint: 'events-after-reload' }, async (disc) => {
    const { d: srcD } = await clubWithNight(5);
    const backup = srcD.exportAll().data;
    const app = await boot({ seed: 9 });
    const d = createDriver(app);
    d.addPlayers(3); // pre-existing local data
    const toasts = await d.importJson(backup, [false, true]); // Cancel = replace, OK = confirm
    expect(toasts.join(' '), 'setup: import reported success').toMatch(/Data replaced/);
    expect(app.state.tournaments.length, 'setup: imported event in memory').toBe(1);
    const reloaded = await boot({ data: app.stored() });
    disc.observe('events-after-reload', () => expect(reloaded.state.tournaments.length, 'imported events lost on reload').toBe(1));
  });

  discrepancy('DISC-06', 'after a single-event import, a reload still shows the event', { checkpoint: 'event-after-reload' }, async (disc) => {
    const { d: srcD, t } = await clubWithNight(6);
    const payload = srcD.exportTournament(t).data;
    const app = await boot({ seed: 10 });
    const d = createDriver(app);
    d.addPlayers(2); // something already saved locally
    const toasts = await d.importJson(payload);
    expect(toasts.join(' '), 'setup: import reported success').toMatch(/Imported event/);
    expect(app.state.tournaments.length, 'setup: imported event in memory').toBe(1);
    const reloaded = await boot({ data: app.stored() });
    disc.observe('event-after-reload', () => expect(reloaded.state.tournaments.length, 'imported event lost on reload').toBe(1));
  });
});

describe('DISC-07 importing an event that already exists', () => {
  discrepancy('DISC-07', 're-importing the same event (keep both) never changes anyone\'s ranking points', { checkpoint: 'points-unchanged' }, async (disc) => {
    const { app, d, t } = await clubWithNight(7);
    const payload = d.exportTournament(t).data;
    const before = pointsOf(app);
    await d.importJson(payload, [false]); // "already exists. Replace it?" → Cancel = import as copy
    expect(app.state.tournaments.length, 'setup: the copy was imported').toBe(2);
    disc.observe('points-unchanged', () => expect(pointsOf(app)).toEqual(before));
  });
});

describe('DISC-08 robustness to malformed stored data', () => {
  // Each case allows EXACTLY the boot-crash errors that constitute this discrepancy
  // (observed 2026-11-08); any other page error still fails the test.
  for (const [label, tournaments, expectedErrors] of [
    ['a null tournament entry', [null], [
      /^Error: Failed to load state TypeError: Cannot read properties of null \(reading 'rankingApplied'\)/,
      /^Error: Uncaught \[TypeError: Cannot read properties of null \(reading 'placements'\)\]/]],
    ['a tournament without playerIds', [{ id: 'tx', name: 'Broken', type: 'monster', rounds: [] }], [
      /^Error: Uncaught \[TypeError: Cannot read properties of undefined \(reading 'length'\)\]/]],
    ['a numeric tournament name', [{ id: 'tx', name: 42, type: 'monster', playerIds: [], rounds: [] }], [
      /^Error: Uncaught \[TypeError: str\.replace is not a function\]/]],
  ]) {
    discrepancy('DISC-08', `app still finishes booting with ${label} (snapshot check + auto-refresh start)`, {
      checkpoint: 'boot-completed',
      allowPageErrors: expectedErrors, // the boot crash IS this discrepancy
    }, async (disc) => {
      const app = await boot({ operator: false, data: { players: [], tournaments },
        snapshot: { type: 'full', players: [], tournaments: [] } });
      disc.observe('boot-completed', () => {
        expect(app.eval('appRefreshTimer'), 'auto-refresh never started').toBeTruthy();
        expect(app.eval('clubSnapshotMeta.status'), 'snapshot never fetched').not.toBe('pending');
      });
    });
  }
});

describe('DISC-09 deleting a ranked event', () => {
  discrepancy('DISC-09', 'operator ranking equals what members see after the backup is published', { checkpoint: 'member-points-match' }, async (disc) => {
    const { app, d } = await clubWithNight(8);
    // second event, then delete the first (finished, ranked) one
    const ids = d.addPlayers(8);
    const t2 = d.createTournament({ type: 'monster', name: 'Second' });
    d.addToEvent(t2, ids);
    const first = app.state.tournaments.find((x) => x.id !== t2.id);
    d.open(first);
    app.call('confirmDeleteTournament');
    expect(app.state.tournaments.some((x) => x.id === first.id), 'setup: ranked event deleted').toBe(false);
    const operatorPoints = pointsOf(app);
    const member = await boot({ operator: false, snapshot: d.exportAll().data });
    expect(member.eval('clubSnapshotMeta.status'), 'setup: member loaded the published backup').toBe('ok');
    disc.observe('member-points-match', () => expect(pointsOf(member)).toEqual(operatorPoints));
  });
});

describe('DISC-10 ids from imported data are not escaped in HTML attributes', () => {
  discrepancy('DISC-10', 'a crafted player id cannot inject markup into the Players list', { checkpoint: 'no-injected-element' }, async (disc) => {
    const evilId = 'x"><img id="injected" src="data:,">';
    const player = { id: evilId, name: 'Crafted', skill: 3, rankingPoints: 2000, rankingDelta: 0, region: '', homeState: '' };
    // Delivered via localStorage here; in production the vector is an imported file or data/latest.json.
    const app = await boot({ data: { players: [player], tournaments: [] } });
    expect(app.state.players.map((p) => p.id), 'setup: crafted player loaded').toEqual([evilId]);
    disc.observe('no-injected-element', () => expect(!!app.window.document.getElementById('injected'), 'markup injected at boot').toBe(false));
  });
});

describe('DISC-14 merge leaves stale references', () => {
  discrepancy('DISC-14', 'after merging players, no tournament field references the removed id', { checkpoint: 'no-stale-reference' }, async (disc) => {
    const { app, ids } = await clubWithNight(12);
    app.call('mergePlayerRecords', ids[0], ids[1]);
    expect(app.state.players.some((p) => p.id === ids[1]), 'setup: merged player removed').toBe(false);
    disc.observe('no-stale-reference', () => expect(JSON.stringify(app.state.tournaments).includes(ids[1])).toBe(false));
  });
});
