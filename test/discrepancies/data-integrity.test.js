/**
 * DISCREPANCIES — persistence, import, data integrity, security.
 * Requires domain-owner review; see docs/AUDIT.md. Expected to fail against the
 * current index.html (run `npm run test:discrepancies` to see the failures).
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
  discrepancy('DISC-06', 'after a successful full replace-import, a reload shows the imported data', async () => {
    const { d: srcD } = await clubWithNight(5);
    const backup = srcD.exportAll().data;
    const app = await boot({ seed: 9 });
    const d = createDriver(app);
    d.addPlayers(3); // pre-existing local data
    const toasts = await d.importJson(backup, [false, true]); // Cancel = replace, OK = confirm
    expect(toasts.join(' ')).toMatch(/Data replaced/);
    const reloaded = await boot({ data: app.stored() });
    expect(reloaded.state.tournaments.length, 'imported events lost on reload').toBe(1);
  });

  discrepancy('DISC-06', 'after a single-event import, a reload still shows the event', async () => {
    const { d: srcD, t } = await clubWithNight(6);
    const payload = srcD.exportTournament(t).data;
    const app = await boot({ seed: 10 });
    const d = createDriver(app);
    d.addPlayers(2); // something already saved locally
    const toasts = await d.importJson(payload);
    expect(toasts.join(' ')).toMatch(/Imported event/);
    expect(app.state.tournaments.length).toBe(1);
    const reloaded = await boot({ data: app.stored() });
    expect(reloaded.state.tournaments.length, 'imported event lost on reload').toBe(1);
  });
});

describe('DISC-07 importing an event that already exists', () => {
  discrepancy('DISC-07', 're-importing the same event (keep both) never changes anyone\'s ranking points', async () => {
    const { app, d, t } = await clubWithNight(7);
    const payload = d.exportTournament(t).data;
    const before = pointsOf(app);
    await d.importJson(payload, [false]); // "already exists. Replace it?" → Cancel = import as copy
    expect(app.state.tournaments.length).toBe(2);
    expect(pointsOf(app)).toEqual(before);
  });
});

describe('DISC-08 robustness to malformed stored data', () => {
  for (const [label, tournaments] of [
    ['a null tournament entry', [null]],
    ['a tournament without playerIds', [{ id: 'tx', name: 'Broken', type: 'monster', rounds: [] }]],
    ['a numeric tournament name', [{ id: 'tx', name: 42, type: 'monster', playerIds: [], rounds: [] }]],
  ]) {
    discrepancy('DISC-08', `app still finishes booting with ${label} (snapshot check + auto-refresh start)`, async () => {
      const app = await boot({ operator: false, data: { players: [], tournaments },
        snapshot: { type: 'full', players: [], tournaments: [] } });
      expect(app.eval('appRefreshTimer'), 'auto-refresh never started').toBeTruthy();
      expect(app.eval('clubSnapshotMeta.status'), 'snapshot never fetched').not.toBe('pending');
    });
  }
});

describe('DISC-09 deleting a ranked event', () => {
  discrepancy('DISC-09', 'operator ranking equals what members see after the backup is published', async () => {
    const { app, d } = await clubWithNight(8);
    // second event, then delete the first (finished, ranked) one
    const ids = d.addPlayers(8);
    const t2 = d.createTournament({ type: 'monster', name: 'Second' });
    d.addToEvent(t2, ids);
    const first = app.state.tournaments.find((x) => x.id !== t2.id);
    d.open(first);
    app.call('confirmDeleteTournament');
    expect(app.state.tournaments.some((x) => x.id === first.id)).toBe(false);
    const operatorPoints = pointsOf(app);
    const member = await boot({ operator: false, snapshot: d.exportAll().data });
    expect(pointsOf(member)).toEqual(operatorPoints);
  });
});

describe('DISC-10 ids from imported data are not escaped in HTML attributes', () => {
  discrepancy('DISC-10', 'a crafted player id cannot inject markup into the Players list', async () => {
    const evilId = 'x"><img id="injected" src="data:,">';
    const player = { id: evilId, name: 'Crafted', skill: 3, rankingPoints: 2000, rankingDelta: 0, region: '', homeState: '' };
    // Delivered via localStorage here; in production the vector is an imported file or data/latest.json.
    const app = await boot({ data: { players: [player], tournaments: [] } });
    expect(!!app.window.document.getElementById('injected'), 'markup injected at boot').toBe(false);
  });
});

describe('DISC-14 merge leaves stale references', () => {
  discrepancy('DISC-14', 'after merging players, no tournament field references the removed id', async () => {
    const { app, ids } = await clubWithNight(12);
    app.call('mergePlayerRecords', ids[0], ids[1]);
    expect(JSON.stringify(app.state.tournaments).includes(ids[1])).toBe(false);
  });
});
