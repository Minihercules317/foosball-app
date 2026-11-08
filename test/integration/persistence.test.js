/**
 * Persistence model: localStorage working state, full JSON export/import, and the
 * GitHub Pages snapshot (data/latest.json) that member devices load on boot.
 *
 * [contract] = intended behavior per README / code comments
 * [char]     = current behavior pinned for refactoring safety (may be a risk — see docs/AUDIT.md)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, STORAGE_KEY } from '../harness/loadApp.js';
import { createDriver, runMonsterNight } from '../factories/driver.js';
import { resetIds } from '../factories/players.js';

const opened = [];
async function boot(opts) { const app = await loadApp(opts); opened.push(app); return app; }
afterEach(() => { while (opened.length) opened.pop().close(); resetIds(); });

const pointsOf = (app) => Object.fromEntries(app.state.players.map((p) => [p.id, p.rankingPoints]));

/** An operator device that has run one Monster night plus one sandbox night. */
async function operatorWithHistory(seed = 11) {
  const app = await boot({ seed });
  const d = createDriver(app, { seed });
  const { t } = runMonsterNight(app, d, { players: 10, rounds: 3, name: 'Official night' });
  return { app, d, t };
}

describe('reload (localStorage)', () => {
  it('[contract] a reload restores exactly what was saved', async () => {
    const { app } = await operatorWithHistory();
    const saved = app.stored();
    const app2 = await boot({ data: saved });
    expect(app2.snapshot()).toEqual(saved);
    expect(app2.errors.map(String)).toEqual([]);
  });

  it('[contract] reload does not re-apply ranking (no double counting on boot)', async () => {
    const { app } = await operatorWithHistory();
    const before = pointsOf(app);
    const app2 = await boot({ data: app.stored() });
    expect(pointsOf(app2)).toEqual(before);
  });
});

describe('full export → snapshot / import', () => {
  it('[contract] export → member device loads snapshot: players, events and ranking identical', async () => {
    const { app, d } = await operatorWithHistory();
    const { data } = d.exportAll();
    expect(data.type).toBe('full');
    const member = await boot({ operator: false, snapshot: data });
    expect(member.eval('clubSnapshotMeta.status')).toBe('ok');
    expect(member.snapshot()).toEqual({ players: data.players, tournaments: data.tournaments });
    expect(pointsOf(member)).toEqual(pointsOf(app));
    // member device persists the snapshot locally
    expect(member.stored().tournaments.length).toBe(data.tournaments.length);
  });

  it('[contract] operator device: snapshot is fetched but NOT applied (local data kept)', async () => {
    const { app } = await operatorWithHistory();
    const other = { type: 'full', players: [], tournaments: [] };
    const op = await boot({ operator: true, data: app.stored(), snapshot: other });
    expect(op.eval('clubSnapshotMeta.status')).toBe('skipped');
    expect(op.state.tournaments.length).toBe(1);
  });

  it('[contract] ?local=1 keeps device data on a member device', async () => {
    const { app } = await operatorWithHistory();
    const m = await boot({ operator: false, data: app.stored(), url: 'http://lcfc.test/index.html?local=1',
      snapshot: { type: 'full', players: [], tournaments: [] } });
    expect(m.eval('clubSnapshotMeta.status')).toBe('skipped');
    expect(m.state.tournaments.length).toBe(1);
  });

  for (const [label, snapshot, status] of [['missing (404)', 404, 'missing'], ['server error', 500, 'error'],
    ['network failure', 'network-error', 'error'], ['wrong shape', { hello: 1 }, 'invalid']]) {
    it(`[contract] member device keeps local data when snapshot is ${label}`, async () => {
      const { app } = await operatorWithHistory();
      const m = await boot({ operator: false, data: app.stored(), snapshot });
      expect(m.eval('clubSnapshotMeta.status')).toBe(status);
      expect(m.state.tournaments.length).toBe(1);
    });
  }

  it('[char] turning operator mode OFF then reloading replaces local data with the snapshot (no prompt)', async () => {
    // README: operator device keeps local data; members load the club file.
    // Risk (AUDIT R-01): an operator who switches mode off loses unexported local work on next load.
    const { app } = await operatorWithHistory();
    const saved = app.stored();
    const reloaded = await boot({ operator: false, data: saved, snapshot: { type: 'full', players: [], tournaments: [] } });
    expect(reloaded.state.tournaments).toEqual([]);
    expect(reloaded.stored().tournaments).toEqual([]);
  });

  it('[contract] full export → replace-import on a fresh operator device round-trips the data (in memory)', async () => {
    const { app, d } = await operatorWithHistory();
    const { data } = d.exportAll();
    const fresh = await boot({ seed: 2 });
    const fd = createDriver(fresh);
    await fd.importJson(data, [false, true]); // Cancel = replace, then confirm
    expect(fresh.snapshot()).toEqual({ players: data.players, tournaments: data.tournaments });
    expect(pointsOf(fresh)).toEqual(pointsOf(app));
  });

  it('[contract] single-event export → import into an empty club recreates the event and its players', async () => {
    const { d, t } = await operatorWithHistory();
    const { data } = d.exportTournament(t);
    expect(data.type).toBe('tournament');
    const fresh = await boot({ seed: 3 });
    await createDriver(fresh).importJson(data);
    expect(fresh.state.tournaments.map((x) => x.id)).toEqual([t.id]);
    expect(fresh.state.players.map((p) => p.id).sort()).toEqual([...t.playerIds].sort());
  });
});

describe('cross-tab refresh', () => {
  it('[contract] a storage event from another tab reloads state in this tab', async () => {
    const { app } = await operatorWithHistory();
    const other = app.stored();
    other.tournaments[0].name = 'Renamed in other tab';
    app.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(other));
    app.window.dispatchEvent(new app.window.StorageEvent('storage', { key: STORAGE_KEY }));
    expect(app.state.tournaments[0].name).toBe('Renamed in other tab');
  });

  it('[char] while the score modal is open, other-tab saves are ignored and this tab\'s next save wins', async () => {
    // Risk (AUDIT R-04): whole-blob last-writer-wins between operator tabs.
    const { app, d } = await operatorWithHistory();
    const ids = d.addPlayers(8);
    const t2 = d.createTournament({ type: 'monster', name: 'Second' });
    d.addToEvent(t2, ids);
    const r = d.generateRound(t2);
    app.call('openScoreModal', r.number, r.matches[0].id);
    const other = app.stored();
    other.tournaments.push({ ...other.tournaments[0], id: 'from_other_tab', name: 'Other tab event' });
    app.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(other));
    app.window.dispatchEvent(new app.window.StorageEvent('storage', { key: STORAGE_KEY }));
    app.window.document.getElementById('score-a').value = '5';
    app.window.document.getElementById('score-b').value = '2';
    app.call('submitScore');
    expect(app.stored().tournaments.some((x) => x.id === 'from_other_tab')).toBe(false);
  });

  it('[char] the 5s tick on the tournament view reloads from storage, discarding unsaved in-memory edits', async () => {
    const { app, d, t } = await operatorWithHistory();
    d.open(t);
    app.state.tournaments[0].name = 'unsaved edit';
    d.tick();
    expect(app.state.tournaments[0].name).not.toBe('unsaved edit');
  });
});
