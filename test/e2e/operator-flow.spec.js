import { test, expect } from '@playwright/test';
import { preparePage, operatorStorage, appState, SYNTHETIC_CLUB } from './helpers.js';

const rosterOnly = { players: SYNTHETIC_CLUB.players.slice(0, 8), tournaments: [] };

test('operator runs a Monster DYP round end-to-end through the UI', async ({ page }) => {
  const errors = await preparePage(page, { storage: operatorStorage(rosterOnly) });
  await page.goto('/index.html');
  await expect(page.locator('#btn-operator-mode')).toContainText('ON');

  // Create tournament
  await page.locator('[onclick="startCreateTournament()"]').first().click();
  await page.locator('#t-name').fill('E2E Synthetic Night');
  await page.locator('.type-btn[data-type="monster"]').click();
  await page.locator('[onclick="saveTournament()"]').click();
  await expect(page.locator('#view-tournament')).toBeVisible();

  // Add all 8 players
  const boxes = page.locator('#add-player-roster input.add-player-cb');
  await expect(boxes).toHaveCount(8);
  for (let i = 0; i < 8; i++) await boxes.nth(i).check();
  await page.locator('[onclick="addSelectedPlayersToTournament()"]').click();

  // Generate a round → 2 matches, nobody sits (8 % 4 == 0)
  await page.locator('#generate-round-btn').click();
  let s = await appState(page);
  expect(s.tournaments[0].rounds).toHaveLength(1);
  expect(s.tournaments[0].rounds[0].matches).toHaveLength(2);
  expect(s.tournaments[0].rounds[0].sitOutIds).toEqual([]);

  // Enter a score via the scoresheet modal
  await page.locator('[data-tab="matches"]').click();
  await page.getByRole('button', { name: 'Enter Score' }).first().click();
  await expect(page.locator('#score-modal')).toBeVisible();
  await page.locator('#score-a').fill('5');
  await page.locator('#score-b').fill('3');
  await page.locator('[onclick="submitScore()"]').click();
  await expect(page.locator('#score-modal')).toBeHidden();

  s = await appState(page);
  const done = s.tournaments[0].rounds[0].matches.filter((m) => m.status === 'done');
  expect(done).toHaveLength(1);
  expect([done[0].scoreA, done[0].scoreB]).toEqual([5, 3]);

  // Persisted: survives a reload
  await page.reload();
  s = await appState(page);
  expect(s.tournaments[0].rounds[0].matches.filter((m) => m.status === 'done')).toHaveLength(1);
  expect(errors.map(String)).toEqual([]);
});

test('invalid score (draw) is rejected and nothing is saved', async ({ page }) => {
  await preparePage(page, { storage: operatorStorage(rosterOnly) });
  await page.goto('/index.html');
  await page.evaluate(() => {
    startCreateTournament();
    document.querySelector('.type-btn[data-type="monster"]').click();
    saveTournament();
    const t = getCurrentTournament();
    t.playerIds = state.players.map((p) => p.id);
    saveState();
    generateRound();
  });
  await page.locator('[data-tab="matches"]').click();
  await page.getByRole('button', { name: 'Enter Score' }).first().click();
  await page.locator('#score-a').fill('4');
  await page.locator('#score-b').fill('4');
  await page.locator('[onclick="submitScore()"]').click();
  await expect(page.locator('#toast-container')).toContainText('draw');
  const s = await appState(page);
  expect(s.tournaments[0].rounds[0].matches.every((m) => m.status !== 'done')).toBe(true);
});
