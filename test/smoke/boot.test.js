import { describe, it, expect, afterEach } from 'vitest';
import { loadApp } from '../harness/loadApp.js';

let app;
afterEach(() => app?.close());

describe('harness boot', () => {
  it('boots index.html without uncaught errors and exposes globals', async () => {
    app = await loadApp();
    expect(app.errors.map(String)).toEqual([]);
    expect(app.eval('APP_VERSION')).toMatch(/^\d+\.\d+$/);
    expect(typeof app.eval('generateRound')).toBe('function');
    expect(app.state.players).toEqual([]);
  });
});
