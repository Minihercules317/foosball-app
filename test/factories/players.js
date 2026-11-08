/**
 * Fabricated player factory. NEVER use real club members as fixtures.
 * Names are built from invented syllables so they cannot collide with real people.
 */
import { makeRng } from './random.js';

const FIRST = ['Azzo', 'Brin', 'Cael', 'Dova', 'Esko', 'Fenna', 'Gid', 'Hollis', 'Ivo', 'Juno',
  'Kestra', 'Lio', 'Mabry', 'Nyx', 'Orrin', 'Pell', 'Quin', 'Rook', 'Sela', 'Tamsin',
  'Ulla', 'Vex', 'Wren', 'Xandr', 'Yara', 'Zeb'];
const LAST = ['Testwood', 'Mockley', 'Fakeham', 'Stubbs', 'Fixturo', 'Samplegate', 'Dummond',
  'Placehold', 'Synthby', 'Fabrikant', 'Seedwell', 'Randall-Q'];

/** Adversarial display names used to probe escaping and "A + B" name parsing. */
export const ADVERSARIAL_NAMES = [
  'Plus + Sign',
  '<img src=x onerror="window.__xss=1">',
  "O'Quote \"Double\"",
  'Ünïcødé Ñame',
  '   Padded   ',
  'a'.repeat(80),
];

let seq = 0;
export function resetIds() { seq = 0; }
export function fakeId(prefix = 'p') {
  seq += 1;
  return `${prefix}_${String(seq).padStart(4, '0')}`;
}

/**
 * @param {number} n
 * @param {object} [o]
 * @param {number} [o.seed]
 * @param {boolean} [o.uniqueNames=true]
 * @param {number|function} [o.rankingPoints=2000]
 */
export function makePlayers(n, o = {}) {
  const rng = makeRng(o.seed ?? 7);
  const used = new Set();
  const players = [];
  for (let i = 0; i < n; i++) {
    let name;
    do {
      name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
      if (used.has(name)) name = `${name} ${i + 1}`;
    } while (o.uniqueNames !== false && used.has(name));
    used.add(name);
    const pts = typeof o.rankingPoints === 'function' ? o.rankingPoints(i, rng) : (o.rankingPoints ?? 2000);
    players.push({
      id: fakeId('p'),
      name,
      skill: o.skill ?? rng.int(1, 6),
      rankingPoints: pts,
      rankingDelta: 0,
      region: '',
      homeState: '',
    });
  }
  return players;
}
