import { test, expect } from '@playwright/test';
import { preparePage, operatorStorage, appState, SYNTHETIC_CLUB } from './helpers.js';

test('member device loads the published club file read-only', async ({ page }) => {
  const errors = await preparePage(page, { snapshot: SYNTHETIC_CLUB });
  await page.goto('/index.html');
  await expect(page.locator('#member-readonly-banner')).toBeVisible();
  await expect(page.locator('#btn-import-data')).toBeHidden();
  const s = await appState(page);
  expect(s.tournaments.map((t) => t.id)).toEqual(SYNTHETIC_CLUB.tournaments.map((t) => t.id));
  // Ranking totals equal those in the published file
  const pts = Object.fromEntries(s.players.map((p) => [p.id, p.rankingPoints]));
  expect(pts).toEqual(Object.fromEntries(SYNTHETIC_CLUB.players.map((p) => [p.id, p.rankingPoints])));
  await page.locator('[data-nav="stats"]').first().click();
  expect(errors.map(String)).toEqual([]);
});

test('TV board in a second tab picks up a score entered in the operator tab', async ({ context }) => {
  const operator = await context.newPage();
  const errors = await preparePage(operator, { storage: operatorStorage({ players: SYNTHETIC_CLUB.players.slice(0, 8), tournaments: [] }) });
  await operator.goto('/index.html');
  const ids = await operator.evaluate(() => {
    startCreateTournament();
    document.querySelector('.type-btn[data-type="monster"]').click();
    saveTournament();
    const t = getCurrentTournament();
    t.playerIds = state.players.map((p) => p.id);
    saveState();
    generateRound();
    return { round: t.rounds[0].number, match: t.rounds[0].matches[0].id };
  });

  const tv = await context.newPage();
  tv.on('pageerror', (e) => errors.push(e));
  await tv.route('**/data/latest.json*', (r) => r.fulfill({ status: 404, body: '' }));
  await tv.goto('/index.html');
  await tv.locator('[onclick="openSpectatorFromHome()"]').first().click();
  await expect(tv.locator('#view-spectator')).toBeVisible();

  await operator.evaluate(({ round, match }) => {
    openScoreModal(round, match);
    document.getElementById('score-a').value = '5';
    document.getElementById('score-b').value = '1';
    submitScore();
  }, ids);

  await expect.poll(() => tv.evaluate((id) => state.tournaments[0].rounds[0].matches.find((m) => m.id === id).status, ids.match),
    { timeout: 8_000 }).toBe('done');
  expect(errors.map(String)).toEqual([]);
});
