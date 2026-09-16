// @timeout 60000
// #762 (rokhm1): "I played the action card of ackbar and madine which reduces
// every unit's health by one, but I could not kill the assault carrier with one
// red shot - it should have only had 1hp."
//
// Point Blank Assault: "All units in the system have -1 health, to a minimum of
// 1." The engine applies it as +1 combat damage to every unit in the system at
// the moment it is played, capped so nothing drops below 1 remaining (#667: an
// earlier form only ever RAISED damage to 1, so an already-damaged unit got no
// reduction). This pins that an assault carrier (2 red health) really is left on
// 1 — i.e. one red hit kills it — which is what the reporter expected.
//
// Verified here, so his carrier survived for another reason. RAW (Rules
// Reference, "Assign Damage"): the attacking player assigns their own damage,
// and red results can only go on units with RED health, black results only on
// BLACK health. His board: Star Destroyer and Assault Carrier are red, TIE
// Fighter black.
//
// Also pins the RAW playability gate that made this card look missing while
// writing the test: a combat action card needs one of its NAMED leaders already
// in the system (Ackbar or Madine here) — having them in the leader pool is not
// enough.
// Run: node scripts/test-point-blank-assault-762.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { register } = await import('tsx/esm/api'); register();
const { createGame } = await import('../src/engine/setup.ts');
const combat = await import('../src/engine/combat.ts');
const j = (p) => JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf8'));
const data = { systems: j('systems.json'), adjacency: j('adjacency.json'), leaders: j('leaders.json'), actions: j('actions.json'), missions: j('missions.json'), objectives: j('objectives.json'), tactics: j('tactics.json'), probes: j('probes.json') };
let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };
const S = 'utapau';
let k = 0; const unit = (t, side) => ({ instanceId: `pba${k++}`, typeId: t, side, damage: 0 });
/** Reporter's shape: Star Destroyer + Assault Carrier + TIE vs a Rebel fleet. */
function board({ leaderInSystem = true } = {}) {
  const G = createGame(data, { seed: 3, autoSetupUnits: true, expansion: { enabled: true, roeUnits: true, roeMissions: true } });
  for (const ss of Object.values(G.map.systems)) ss.units = [];
  G.map.systems[S].units.push(unit('star-destroyer', 'Empire'), unit('assault-carrier', 'Empire'), unit('tie-fighter', 'Empire'));
  G.map.systems[S].units.push(unit('mon-cala-cruiser', 'Rebel'), unit('x-wing', 'Rebel'));
  G.rebel.actionHand = ['point-blank-assault']; G.empire.actionHand = [];
  G.rebel.leaderPool = G.rebel.leaderPool.filter((l) => l !== 'admiral-ackbar');
  if (leaderInSystem) G.rebel.leadersOnBoard[S] = ['admiral-ackbar'];
  else G.rebel.leaderPool.push('admiral-ackbar'); // in the POOL only
  return G;
}
/** Run to the Rebel's start-of-combat window; play the listed cards. */
function toCardWindow(G, cardsToPlay) {
  combat.beginCombat(G, 'Rebel', S, S); combat.runCombat(G);
  let offered = null;
  for (let i = 0; i < 10; i++) {
    const pc = G.pendingChoice; if (!pc) break;
    if (pc.kind === 'CombatAddLeaderPick') { combat.resolveCombatAddLeaderPick(G, null); continue; }
    if (pc.kind === 'CombatStartActionCards') {
      if (pc.side === 'Rebel') { offered = [...pc.playable]; combat.resolveCombatStartActionCards(G, cardsToPlay); break; }
      combat.resolveCombatStartActionCards(G, []); continue;
    }
    break; // dice started: no Rebel window was offered
  }
  return offered;
}
const remaining = (G, typeId) => { const u = G.map.systems[S].units.find((x) => x.typeId === typeId); const t = G.catalog.unitTypes[typeId]; return u ? t.health.value - u.damage : null; };

console.log('[ the card leaves a 2-health carrier on 1 — one red hit kills it ]');
{
  const G = board();
  const offered = toCardWindow(G, ['point-blank-assault']);
  check('the card is offered with Ackbar in the system', Array.isArray(offered) && offered.includes('point-blank-assault'), JSON.stringify(offered));
  check('the effect is recorded on the combat', G.pendingCombat?.flags?.allUnitsMinusOneHealthApplied === true);
  check('assault carrier (2 red health) is left on 1', remaining(G, 'assault-carrier') === 1, String(remaining(G, 'assault-carrier')));
  check('Star Destroyer (4) is left on 3', remaining(G, 'star-destroyer') === 3, String(remaining(G, 'star-destroyer')));
  check('a 1-health TIE stays on 1 (the card\'s minimum)', remaining(G, 'tie-fighter') === 1, String(remaining(G, 'tie-fighter')));
  check('it hits BOTH sides: the Rebel cruiser is on 3 too', remaining(G, 'mon-cala-cruiser') === 3, String(remaining(G, 'mon-cala-cruiser')));
  check('and the Rebel\'s own 1-health X-wing is unharmed', remaining(G, 'x-wing') === 1, String(remaining(G, 'x-wing')));
}

console.log('[ RAW gate: the named leader must be IN the system, not just in the pool ]');
{
  const G = board({ leaderInSystem: false });
  const offered = toCardWindow(G, []);
  check('with Ackbar only in the leader pool, the card is not offered', offered === null || !offered.includes('point-blank-assault'), JSON.stringify(offered));
  check('and nothing was damaged', remaining(G, 'assault-carrier') === 2, String(remaining(G, 'assault-carrier')));
}
console.log(fail === 0 ? `\nALL PASS — ${pass} passed, 0 failed` : `\nFAILURES — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
