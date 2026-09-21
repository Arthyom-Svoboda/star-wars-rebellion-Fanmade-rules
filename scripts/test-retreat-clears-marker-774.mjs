// #774 — RoE p.7 "Removing Target Markers": a player's ground unit in a system
// holding the opponent's target marker, with none of the opponent's ground
// units there, removes the marker. Marker removal is held off while a combat is
// pending, and the post-combat re-check only looked at the COMBAT system — so a
// Rebel ground force RETREATING into a system that held only the Empire's
// Secure the Plans marker left the marker standing (and Death Star Plans
// blocked) until the next Refresh sweep.
// Run: node scripts/test-retreat-clears-marker-774.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { register } = await import('tsx/esm/api'); register();
const { createGame } = await import('../src/engine/setup.ts');
const combat = await import('../src/engine/combat.ts');
const M = await import('../src/engine/mechanics.ts');
const handlers = await import('../src/engine/handlers/index.ts');
handlers.registerAll();

const j = (p) => JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf-8'));
const data = { systems: j('systems.json'), adjacency: j('adjacency.json'), leaders: j('leaders.json'), actions: j('actions.json'), missions: j('missions.json'), objectives: j('objectives.json'), tactics: j('tactics.json'), probes: j('probes.json') };

let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };

/** Rebel frigate + airspeeders under Imperial attack; the escape system holds
 *  the Empire's Secure the Plans marker and no units. `imperialGroundThere`
 *  puts a stormtrooper in the escape system (marker must then stay). */
function run({ imperialGroundThere }) {
  const G = createGame(data, { seed: 11, expansion: { enabled: true, roeUnits: true } });
  for (const ss of Object.values(G.map.systems)) { ss.units = []; ss.targetMarkers = []; }
  G.rebel.leadersOnBoard = {}; G.empire.leadersOnBoard = {};
  const [target, [, escape]] = Object.entries(G.catalog.adjacency)
    .find(([sid, adj]) => (adj?.length ?? 0) >= 2 && G.map.systems[sid]) ?? [];
  G.map.systems[escape].loyalty = 'rebel';
  M.placeTargetMarker(G, escape, 'secure-the-plans', 'Empire');
  if (imperialGroundThere) M.deployUnit(G, 'Empire', 'stormtrooper', escape);

  M.deployUnit(G, 'Rebel', 'nebulon-b-frigate', target);
  M.deployUnit(G, 'Rebel', 'airspeeder', target);
  M.deployUnit(G, 'Rebel', 'airspeeder', target);
  G.rebel.leadersOnBoard[target] = ['general-madine'];
  M.deployUnit(G, 'Empire', 'star-destroyer', target);
  M.deployUnit(G, 'Empire', 'stormtrooper', target);
  G.empire.leadersOnBoard[target] = ['darth-vader'];

  combat.beginCombat(G, 'Empire', [target], target);
  combat.runCombat(G);
  let guard = 0;
  while (G.pendingChoice?.kind === 'CombatAddLeaderPick' && guard++ < 10) combat.resolveCombatAddLeaderPick(G, null);
  G.pendingChoice = undefined;
  const here = G.map.systems[target].units.filter((u) => u.side === 'Rebel');
  G.pendingChoice = {
    kind: 'RetreatDecision', side: 'Rebel', systemId: target,
    legalDestinations: [escape],
    availableUnits: here.map((u) => u.instanceId),
    leadersInSystem: ['general-madine'],
  };
  const r = combat.resolveRetreatDecision(G, escape, here.map((u) => u.instanceId), 'general-madine');
  return { G, r, escape, target };
}

console.log('\n[ #774 — retreating ground units strip the opponent\'s marker at combat end ]');
{
  const { G, r, escape, target } = run({ imperialGroundThere: false });
  check('retreat succeeds', r.ok, r.reason);
  check('the Rebel force (incl. airspeeders) arrived',
    G.map.systems[escape].units.filter((u) => u.side === 'Rebel').length === 3,
    JSON.stringify(G.map.systems[escape].units.map((u) => u.typeId)));
  check('the combat is over', !G.pendingCombat, `step=${G.pendingCombat?.step} choice=${G.pendingChoice?.kind}`);
  check('Secure the Plans marker removed from the retreat destination',
    !M.hasTargetMarker(G, escape, 'secure-the-plans'),
    JSON.stringify(G.map.systems[escape].targetMarkers));
  check('combat system untouched', G.map.systems[target] !== undefined);
}

console.log('\n[ guard — marker stays when Imperial ground units are there ]');
{
  const { G, r, escape } = run({ imperialGroundThere: true });
  // An Imperial ground unit there makes it a contested destination; if RAW
  // refuses the retreat, the marker trivially stays — either way it must stay.
  check('marker still present', M.hasTargetMarker(G, escape, 'secure-the-plans'),
    `retreat=${JSON.stringify(r)} markers=${JSON.stringify(G.map.systems[escape].targetMarkers)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
