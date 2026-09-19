// #772 — two Death Stars in one combat, Rebels holding both Death Star Plans.
// The first Plans scored and destroyed a Death Star; a round later the engine
// offered the second Plans too. RR p.13 (Objective Cards): "Only one objective
// can be played during each combat." The per-round Death Star Plans window
// (#139/#146) never checked whether an objective had already been scored.
//
// Run: node scripts/test-dsplans-once-per-combat-772.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { register } = await import('tsx/esm/api'); register();
const { createGame } = await import('../src/engine/setup.ts');
const combat = await import('../src/engine/combat.ts');

const j = (p) => JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf8'));
const data = {
  systems: j('systems.json'), adjacency: j('adjacency.json'), leaders: j('leaders.json'),
  actions: j('actions.json'), missions: j('missions.json'), objectives: j('objectives.json'),
  tactics: j('tactics.json'), probes: j('probes.json'),
};
let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };

const SYS = 'corellia';
const offered = (G) => G.pendingChoice?.kind === 'DeathStarPlansAttempt';

/** Combat at SYS with two Death Stars and enough X-Wings to survive, paused at
 *  the first "after the space battle step" window. */
function setup(seed) {
  const G = createGame(data, { seed });
  G.map.systems[SYS].units = [
    { instanceId: 'ds1', typeId: 'death-star', side: 'Empire', damage: 0 },
    { instanceId: 'ds2', typeId: 'death-star', side: 'Empire', damage: 0 },
    { instanceId: 'st1', typeId: 'stormtrooper', side: 'Empire', damage: 0 },
    ...[1, 2, 3, 4].map((i) => ({ instanceId: `xw${i}`, typeId: 'x-wing', side: 'Rebel', damage: 0 })),
  ];
  G.rebel.objectiveHand = ['death-star-plans-2', 'death-star-plans-3'];
  G.rebel.actionHand = []; G.empire.actionHand = [];
  G.rebel.leaderPool = []; G.empire.leaderPool = [];
  combat.beginCombat(G, 'Rebel', [SYS], SYS);
  const c = G.pendingCombat;
  c.roundTheatersDone = ['space'];
  c.dsPlansOfferedThisRound = false;
  combat.runCombat(G);
  return { G, c };
}
/** Re-open the next round's window on the same combat. */
function nextRoundWindow(G, c) {
  if (G.pendingChoice) G.pendingChoice = undefined;
  c.roundTheatersDone = ['space'];
  c.dsPlansOfferedThisRound = false;
  combat.runCombat(G);
}

console.log('\n[ #772 a scored Death Star Plans closes the window for the second copy ]');
{
  // Find a seed whose 3-die roll lands a direct hit.
  let G, c, seed;
  for (seed = 1; seed < 400; seed++) {
    ({ G, c } = setup(seed));
    if (!offered(G)) continue;
    combat.resolveDeathStarPlansAttempt(G, true, 'ds1');
    if (!G.map.systems[SYS].units.some((u) => u.instanceId === 'ds1')) break;
  }
  check('found a seed where the first Plans destroyed a Death Star', seed < 400, `seed=${seed}`);
  check('the combat recorded an objective as played', c.objectivePlayedThisCombat === true);
  check('the second Death Star is still there',
    G.map.systems[SYS].units.some((u) => u.instanceId === 'ds2'));
  const heldCard = ['death-star-plans-2', 'death-star-plans-3'].filter((id) => G.rebel.objectiveHand.includes(id));
  check('one Plans card is still in hand', heldCard.length === 1, JSON.stringify(G.rebel.objectiveHand));
  if (G.pendingCombat === c) {
    nextRoundWindow(G, c);
    check('next round: the second Plans is NOT offered', !offered(G), `pendingChoice=${G.pendingChoice?.kind}`);
  } else {
    check('combat still running for the next-round check', false, 'combat ended');
  }
}

console.log('\n[ control: a MISSED Plans still leaves the window open next round ]');
{
  // RR p.10: on a miss "The card can be used during a future combat round."
  const { G, c } = setup(1);
  check('window offered in round 1', offered(G), `pendingChoice=${G.pendingChoice?.kind}`);
  G.pendingChoice = undefined; // decline without scoring
  nextRoundWindow(G, c);
  check('no objective recorded', !c.objectivePlayedThisCombat);
  check('window offered again next round', offered(G), `pendingChoice=${G.pendingChoice?.kind}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
