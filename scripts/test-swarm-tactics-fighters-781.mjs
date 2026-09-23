// #781 — Swarm Tactics counts FIGHTERS, not ships.
//
// Reporter (playing Empire) fought a lone TIE Fighter against a Mon Calamari
// Cruiser and a Corellian Corvette and was offered the card's TOP ability:
//     "If there are more Imperial fighters than Rebel fighters, deal 2 damage."
// They read it as "more ships" and filed it as a bug. It is not: the Cruiser
// and the Corvette are CAPITAL ships, so the fighter tally is 1–0 and the top
// legitimately applies.
//
// This pins the reading so a future "fix" can't quietly widen 'fighter' to
// mean any ship, and pins the modal note that now shows the live tally.
//
// Run: node scripts/test-swarm-tactics-fighters-781.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const { register } = await import('tsx/esm/api');
register();

const { createGame } = await import('../src/engine/setup.ts');
const M = await import('../src/engine/mechanics.ts');
const combat = await import('../src/engine/combat.ts');
const { cinematicSelectOptions, cinematicTopConditionNote } = await import('../src/engine/cinematicTactics.ts');

function loadJson(p) { return JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf-8')); }
const data = {
  systems: loadJson('systems.json'), adjacency: loadJson('adjacency.json'),
  leaders: loadJson('leaders.json'), actions: loadJson('actions.json'),
  missions: loadJson('missions.json'), objectives: loadJson('objectives.json'),
  tactics: loadJson('tactics.json'), probes: loadJson('probes.json'),
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); fail++; }
};

const SWARM = 'cin-empire-space-swarm-tactics';

const baseOpts = (seed) => ({
  seed, forcedBaseSystem: 'sullust',
  forcedRebelLoyalty: ['naboo', 'corellia', 'kashyyyk'],
  forcedImperialLoyalty: ['alderaan', 'malastare', 'mygeeto', 'rodia', 'utapau'],
  expansion: { enabled: true, cinematicCombat: true },
});

/** Stand up the reported space battle at `sys` and return the Empire's
 *  Swarm Tactics option plus its condition note. */
function swarmAt(seed, rebelTypes) {
  const G = createGame(data, baseOpts(seed));
  M.deployUnit(G, 'Empire', 'tie-fighter', 'felucia');
  for (const t of rebelTypes) M.deployUnit(G, 'Rebel', t, 'felucia');
  combat.beginCombat(G, 'Rebel', 'malastare', 'felucia');
  const c = G.pendingCombat;
  const opt = (cinematicSelectOptions(G, c, 'Empire', 'space') ?? []).find((o) => o.cardId === SWARM);
  const note = cinematicTopConditionNote(G, c, 'Empire', 'space', SWARM);
  return { G, c, opt, note };
}

// ---- The reported board: 1 TIE vs a Cruiser + a Corvette ----
console.log('\n[ #781: TIE Fighter vs Mon Cala Cruiser + Corellian Corvette ]');
{
  const { opt, note } = swarmAt(7810, ['mon-cala-cruiser', 'corellian-corvette']);
  check('Swarm Tactics is on offer', !!opt);
  check('card text still reads "fighters", not "ships"',
    /more Imperial fighters than Rebel fighters/i.test(data.tactics.find?.((t) => t.id === SWARM)?.primaryText
      ?? (data.tactics.tactics ?? []).find((t) => t.id === SWARM)?.primaryText ?? ''));
  check('TOP is usable — capital ships are not fighters (1 > 0)', opt?.primaryUsable === true);
  check('modal note reports the live tally', !!note && /yours 1, theirs 0/.test(note.text), note?.text);
  check('modal note marks the condition met', note?.met === true);
}

// ---- Rebel X-Wings DO count: 1 TIE vs 2 X-Wings blocks the top ----
console.log('\n[ #781: TIE Fighter vs 2 X-Wings — top must be blocked ]');
{
  const { opt, note } = swarmAt(7811, ['x-wing', 'x-wing']);
  check('TOP is NOT usable when the Rebels have more fighters', opt?.primaryUsable === false);
  check('modal note reports 1 vs 2', !!note && /yours 1, theirs 2/.test(note.text), note?.text);
  check('modal note marks the condition unmet', note?.met === false);
}

// ---- Equal fighter counts also block it ("more", not "at least as many") ----
console.log('\n[ #781: 1 TIE vs 1 X-Wing — a tie is not "more" ]');
{
  const { opt } = swarmAt(7812, ['x-wing']);
  check('TOP blocked on an equal tally', opt?.primaryUsable === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
