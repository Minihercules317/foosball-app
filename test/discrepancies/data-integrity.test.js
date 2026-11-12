/**
 * DISCREPANCIES — persistence, import, data integrity, security.
 * (DISC-06 was resolved in v7.34 → test/regression/resolved-discrepancies.test.js; DISC-07, DISC-08
 * and DISC-10 in v7.42 → test/regression/resolved-discrepancies-v742.test.js. DISC-09 no longer
 * reproduces on v7.42 either, but it is left here unchanged until the owner decides; see its note.)
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

// v7.42 status (2026-11-12): routine CI reports DISCREPANCY NO LONGER REPRODUCES. v7.42's
// confirmDeleteTournament rebuilds every player's points from the remaining events' stored
// deltas, so operator totals now equal what members load. That is the OPPOSITE of owner rule 6
// ("a deleted event's contribution may stay until a recalculation"; docs/AUDIT.md). Until the
// owner confirms the new behavior, this check stays unchanged and red in routine CI, together
// with DISC-17's setup assertion. Do not convert it, and do not rewrite either one to endorse
// immediate removal.
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

describe('DISC-14 merge leaves stale references', () => {
  discrepancy('DISC-14', 'after merging players, no tournament field references the removed id', { checkpoint: 'no-stale-reference' }, async (disc) => {
    const { app, ids } = await clubWithNight(12);
    app.call('mergePlayerRecords', ids[0], ids[1]);
    expect(app.state.players.some((p) => p.id === ids[1]), 'setup: merged player removed').toBe(false);
    disc.observe('no-stale-reference', () => expect(JSON.stringify(app.state.tournaments).includes(ids[1])).toBe(false));
  });
});
