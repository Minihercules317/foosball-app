// Static checks that run without a browser:
//  1. every inline <script> in index.html parses (catches a broken edit before deploy)
//  2. version markers agree (README "Versioning": APP_VERSION, build comment, lcfc-build meta, <title>)
//  3. data/latest.json (if present) is valid JSON with the full-backup shape the app expects.
//     PARTIAL validation: it rejects the three record shapes demonstrated to break boot
//     (AUDIT DISC-08: null tournament, missing playerIds, non-string name) — not a full schema.
// Read-only: never modifies any file.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

let failures = 0;
const fail = (msg) => { failures++; console.error('✗ ' + msg); };
const ok = (msg) => console.log('✓ ' + msg);

const html = readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
scripts.forEach((m, i) => {
  const line = html.slice(0, m.index).split('\n').length;
  try { new vm.Script(m[1], { filename: `index.html#script${i + 1}(line ${line})` }); }
  catch (e) { fail(`inline script ${i + 1} (starts line ${line}) does not parse: ${e.message}`); }
});
if (!failures) ok(`${scripts.length} inline scripts parse`);

const appVersion = html.match(/const APP_VERSION = '([^']+)'/)?.[1];
const marks = {
  'APP_VERSION': appVersion,
  'build comment': html.match(/LCFC_MANAGER_BUILD v([\d.]+)/)?.[1],
  'lcfc-build meta': html.match(/<meta name="lcfc-build" content="([^"]+)"/)?.[1],
  '<title>': html.match(/<title>LCFC Manager v([\d.]+)/)?.[1],
};
const distinct = new Set(Object.values(marks));
if (distinct.size === 1 && appVersion) ok(`version markers agree (v${appVersion})`);
else fail(`version markers disagree: ${JSON.stringify(marks)}`);

if (existsSync('data/latest.json')) {
  try {
    const d = JSON.parse(readFileSync('data/latest.json', 'utf8'));
    const shapeOk = d && (d.type === 'full' || (Array.isArray(d.players) && Array.isArray(d.tournaments)));
    if (!shapeOk) fail('data/latest.json is not a full backup ({type:"full", players[], tournaments[]})');
    else {
      const badT = d.tournaments.filter((t) => !t || typeof t !== 'object' || !t.id || !Array.isArray(t.playerIds)
        || (t.name != null && typeof t.name !== 'string'));
      const badP = d.players.filter((p) => !p || !p.id || typeof p.name !== 'string');
      if (badT.length || badP.length) fail(`data/latest.json has ${badT.length} malformed tournaments and ${badP.length} malformed players (these break app boot — see AUDIT DISC-08)`);
      else ok(`data/latest.json shape ok (${d.players.length} players, ${d.tournaments.length} events)`);
    }
  } catch (e) { fail('data/latest.json is not valid JSON: ' + e.message); }
}

process.exit(failures ? 1 : 0);
