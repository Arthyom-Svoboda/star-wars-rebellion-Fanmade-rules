// #770 — the Rebel AI played Confrontation's primary ("if the last Imperial
// ground unit is destroyed this round, mark 1 Imperial leader for elimination")
// into a full-health AT-AT + Stormtrooper with a pool of 1 red and 4 black dice.
// The AT-AT's 3 red health was out of reach, so the card was discarded for
// nothing. The picker only counted Imperial ground units ("2 or fewer → likely
// wiped"). It must now decline the primary when the wipe is out of reach, and
// still play it when the wipe is realistic. No encoded state on the report
// (canEncodeState:false), so the board is reproduced synthetically.
// Run: node scripts/test-confrontation-ai-770.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { register } = await import('tsx/esm/api'); register();
const { createGame } = await import('../src/engine/setup.ts');
const cin = await import('../src/engine/cinematicTactics.ts');
const j = (p) => JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf8'));
const data = { systems: j('systems.json'), adjacency: j('adjacency.json'), leaders: j('leaders.json'), actions: j('actions.json'), missions: j('missions.json'), objectives: j('objectives.json'), tactics: j('tactics.json'), probes: j('probes.json') };
let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };

const CONF = 'cin-rebel-ground-confrontation';
const OTHERS = ['hold-them-back', 'take-it-down', 'tow-cables', 'take-cover', 'planetary-shield']
  .map((s) => `cin-rebel-ground-${s}`);
function rebelGroundPick(empire, rebel) {
  const G = createGame(data, { seed: 7, expansion: { enabled: true, roeUnits: true, cinematicCombat: true } });
  const SYS = 'nal-hutta';
  let n = 0;
  const mk = (t, s) => ({ instanceId: `${t}-${n++}`, typeId: t, side: s, damage: 0 });
  G.map.systems[SYS].units = [...empire.map((t) => mk(t, 'Empire')), ...rebel.map((t) => mk(t, 'Rebel'))];
  G.empire.leadersOnBoard = { [SYS]: ['darth-vader'] };
  // As in the report: the cards that would have been the right play are
  // already spent, leaving Confrontation as the only "real" option.
  G.rebel.cinematicTacticDiscard = [...OTHERS];
  const c = { systemId: SYS, round: 1, report: { rounds: [] }, attackerSide: 'Empire' };
  return cin.pickBestCinematicPlay(G, c, 'Rebel', 'ground');
}
const playsPrimary = (p) => p?.cardId === CONF && p?.useTop === true;

console.log('[ #770 — Rebel AI only plays Confrontation when the wipe is reachable ]');
// Report board: AT-AT + Stormtrooper vs Trooper + Airspeeder + 2 Troopers + Vanguard-ish
// black-heavy pool (1 red, 4 black).
const reported = rebelGroundPick(['at-at', 'stormtrooper'],
  ['rebel-trooper', 'rebel-trooper', 'rebel-trooper', 'airspeeder']);
check('full-health AT-AT vs 1 red + 4 black → does NOT play Confrontation primary',
  !playsPrimary(reported), `pick=${JSON.stringify(reported)}`);
// Two Stormtroopers vs 5 black dice: a wipe is realistic.
const easy = rebelGroundPick(['stormtrooper', 'stormtrooper'],
  ['rebel-trooper', 'rebel-trooper', 'rebel-trooper', 'rebel-trooper', 'rebel-trooper']);
check('two Stormtroopers vs 5 black dice → DOES play Confrontation primary',
  playsPrimary(easy), `pick=${JSON.stringify(easy)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
