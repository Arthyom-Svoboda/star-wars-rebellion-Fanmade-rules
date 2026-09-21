// @timeout 120000
// #777 (z1bscw, playing Rebel): "Rapid Mobilization played and base moved with
// Empire ship on old rebel base location. Rebel units including ships stayed
// behind, but no combat initiated."
//
// Imperial SHIPS alone never reveal a hidden base (RR, Rebel Base), so the
// Empire can legally park a Star Destroyer on it. RR, Establishing a New Base:
// the Rebel "moves all units and leaders from the 'Rebel Base' space to the old
// base's system" — a MOVE — and RR, Combat: "When a player moves units to a
// system that contains his opponent's units, a combat is resolved." John's
// ruling (2026-09-21): yes, fight, and the leaders go too.
//
// Pins:
//  - units AND leaders land in the old base's system (the engine used to keep
//    the leaders in the Rebel Base space);
//  - a combat starts there when Imperial units share a theater;
//  - that combat is outside any turn: when it ends the end-of-Command drain
//    resumes (next queued Rapid Mobilization, else Refresh) and no turn flips;
//  - controls: no Imperial units → no combat and the drain carries straight on;
//    a revealed base moves nothing.
// Run: node scripts/test-rm-base-move-combat-777.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { register } = await import('tsx/esm/api'); register();
const { createGame } = await import('../src/engine/setup.ts');
const phases = await import('../src/engine/phases.ts');
const ai = await import('../src/play/randomAI.ts');
const j = (p) => JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf8'));
const data = { systems: j('systems.json'), adjacency: j('adjacency.json'), leaders: j('leaders.json'), actions: j('actions.json'), missions: j('missions.json'), objectives: j('objectives.json'), tactics: j('tactics.json'), probes: j('probes.json') };
let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };
let k = 0;
const unit = (typeId, side) => ({ instanceId: `rm${k++}`, typeId, side, damage: 0 });
const LEADER = 'general-rieekan';

/** End of the Command phase (both passed), hidden base, a Rapid Mobilization
 *  base pick open with one legal new-base candidate. The reporter's shape:
 *  corvette, 2 Y-wings, a transport and ground in the base space; one Star
 *  Destroyer on the old base. */
function board({ imperialAtBase = ['star-destroyer'], queued = 1, revealed = false, seed = 11 } = {}) {
  const G = createGame(data, { seed, autoSetupUnits: true });
  for (const ss of Object.values(G.map.systems)) ss.units = [];
  G.map.rebelBaseSpace.units = [];
  G.rebel.leadersOnBoard = {}; G.empire.leadersOnBoard = {};
  G.rebel.objectiveHand = []; G.rebel.actionHand = []; G.empire.actionHand = [];
  G.rebel.leaderPool = G.rebel.leaderPool.filter((l) => l !== LEADER);
  G.rebelBaseRevealed = revealed;
  G.phase = 'Command'; G.currentPlayer = 'Rebel'; G.passedThisCommand = ['Rebel', 'Empire'];
  G.pendingMission = undefined; G.pendingCombat = undefined;
  G.isGameOver = false; G.winner = undefined;
  const old = G.rebelBaseSystemId;
  const where = revealed ? G.map.systems[old] : G.map.rebelBaseSpace;
  for (const t of ['corellian-corvette', 'y-wing', 'y-wing', 'rebel-transport', 'rebel-trooper']) where.units.push(unit(t, 'Rebel'));
  G.rebel.leadersOnBoard[revealed ? old : 'rebel-base-space'] = [LEADER];
  for (const t of imperialAtBase) G.map.systems[old].units.push(unit(t, 'Empire'));
  const probe = Object.values(G.catalog.probes).find((p) => {
    const ss = G.map.systems[p.systemId];
    return p.systemId !== old && ss && ss.loyalty !== 'imperial' && !G.catalog.systems[p.systemId]?.isCoruscant;
  });
  G.probeDeck = G.probeDeck.filter((id) => id !== probe.id);
  G.pendingRapidMobilizations = Array.from({ length: queued }, () => ({ twoLeaders: false }));
  G.pendingChoice = { kind: 'RapidMobilizationBasePick', side: 'Rebel', baseRevealed: revealed,
    probeSystemIds: [probe.systemId], drawnProbeIds: [probe.id] };
  return { G, old, next: probe.systemId };
}
/** Drive the combat with the heuristic AI, stopping at the next Rapid
 *  Mobilization prompt (that is what the resume should post). */
function settleCombat(G) {
  let guard = 0;
  while ((G.pendingCombat || G.pendingChoice) && guard++ < 800 && !G.isGameOver) {
    if (!G.pendingCombat && G.pendingChoice?.kind === 'RapidMobilizationBranch') break;
    const owner = G.pendingChoice?.side;
    const order = owner ? [owner, owner === 'Rebel' ? 'Empire' : 'Rebel'] : ['Rebel', 'Empire'];
    if (ai.stepOnce(G, order[0])) continue;
    if (ai.stepOnce(G, order[1])) continue;
    break;
  }
  return !G.pendingCombat;
}
const began = (G, sys) => (G.turnLog ?? []).some((e) => e.kind === 'combat-begin' && e.payload?.systemId === sys) || !!G.pendingCombat;

console.log('[ premise: the Star Destroyer on the hidden base did not reveal it ]');
{
  const { G } = board();
  check('base still hidden with only an Imperial ship on it', G.rebelBaseRevealed === false);
}

console.log('[ the reported move: units AND leaders go to the old base, and they fight ]');
{
  const { G, old, next } = board({ queued: 2 });
  const r = phases.resolveRapidMobilizationBasePick(G, next);
  check('base pick accepted', r.ok === true, JSON.stringify(r));
  check('the base moved to the new system and is hidden', G.rebelBaseSystemId === next && G.rebelBaseRevealed === false);
  check('the Rebel Base space is empty (RAW: no units until moved or deployed)', G.map.rebelBaseSpace.units.length === 0);
  const rebelsAtOld = G.map.systems[old].units.filter((u) => u.side === 'Rebel').length;
  check('all 5 units were dropped at the old base', rebelsAtOld === 5 || began(G, old), `rebels=${rebelsAtOld}`);
  check('the leader moved with them (RAW: "all units and leaders")',
    (G.rebel.leadersOnBoard[old] ?? []).includes(LEADER) && !(G.rebel.leadersOnBoard['rebel-base-space'] ?? []).length,
    JSON.stringify(G.rebel.leadersOnBoard));
  check('a combat started at the old base', began(G, old));
  const done = settleCombat(G);
  check('the combat ran to completion', done && !G.isGameOver, `combat=${!!G.pendingCombat} choice=${G.pendingChoice?.kind}`);
  check('then the SECOND queued Rapid Mobilization was offered (the drain resumed)',
    G.pendingChoice?.kind === 'RapidMobilizationBranch' && G.pendingRapidMobilizations?.length === 1,
    `choice=${G.pendingChoice?.kind} queue=${G.pendingRapidMobilizations?.length}`);
  check('the resume flag is cleared', !G.rapidMobilizationCombatResume);
  check('still in Command with both passed — no turn was handed over',
    G.phase === 'Command' && G.currentPlayer === 'Rebel', `phase=${G.phase} current=${G.currentPlayer}`);
}

console.log('[ last queued Rapid Mobilization: after the fight the game goes to Refresh ]');
{
  const { G, old, next } = board({ queued: 1 });
  phases.resolveRapidMobilizationBasePick(G, next);
  check('combat started', began(G, old));
  settleCombat(G);
  check('the Command phase ended after the combat', G.phase !== 'Command' && !G.pendingRapidMobilizations?.length,
    `phase=${G.phase} queue=${G.pendingRapidMobilizations?.length}`);
}

console.log('[ controls ]');
{
  const { G, old, next } = board({ imperialAtBase: [], queued: 2 });
  phases.resolveRapidMobilizationBasePick(G, next);
  check('no Imperial units at the old base → no combat', !began(G, old));
  check('  …units and leader still land there',
    G.map.systems[old].units.filter((u) => u.side === 'Rebel').length === 5 && (G.rebel.leadersOnBoard[old] ?? []).includes(LEADER));
  check('  …and the next Rapid Mobilization is offered straight away',
    G.pendingChoice?.kind === 'RapidMobilizationBranch' && G.pendingRapidMobilizations?.length === 1);

  const rv = board({ imperialAtBase: [], revealed: true, queued: 2 }); // 2: stop before Refresh returns leaders
  phases.resolveRapidMobilizationBasePick(rv.G, rv.next);
  check('revealed base: the units stay in the old system', rv.G.map.systems[rv.old].units.filter((u) => u.side === 'Rebel').length === 5);
  check('revealed base: the leader stays there too (nothing was in the Rebel Base space)',
    (rv.G.rebel.leadersOnBoard[rv.old] ?? []).includes(LEADER) && !(rv.G.rebel.leadersOnBoard['rebel-base-space'] ?? []).length,
    JSON.stringify(rv.G.rebel.leadersOnBoard));
  check('revealed base: no combat', !began(rv.G, rv.old));
}

console.log('[ tripwires ]');
{
  const src = readFileSync(join(ROOT, 'src/engine/combat.ts'), 'utf8');
  check('the turn hand-off skips the Rapid Mobilization combat', /&& !G\.rapidMobilizationCombatResume\)/.test(src));
}
console.log(fail === 0 ? `\nALL PASS — ${pass} passed, 0 failed` : `\nFAILURES — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
