import { readFileSync } from 'node:fs';

export const SYNTHETIC_CLUB = JSON.parse(readFileSync(new URL('../fixtures/synthetic-club.json', import.meta.url), 'utf8'));

/**
 * Prepare a page: intercept data/latest.json with synthetic data (or 404), seed
 * localStorage once per context, collect uncaught page errors.
 */
export async function preparePage(page, { snapshot = null, storage = {} } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.route('**/data/latest.json*', (route) => (snapshot
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) })
    : route.fulfill({ status: 404, body: 'not found' })));
  await page.addInitScript((entries) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, storage);
  return errors;
}

export const operatorStorage = (data) => ({
  lcfc_operator_mode_v1: '1',
  ...(data ? { foosmanager_v1: JSON.stringify(data) } : {}),
});

/** Read app state from the page (top-level `state` binding). */
export const appState = (page) => page.evaluate(() => JSON.parse(JSON.stringify({ players: state.players, tournaments: state.tournaments })));
