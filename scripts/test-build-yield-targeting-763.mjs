// "now they played the construct factory project on sullust with absolutely no
//  sense as they cannot even build another at-at, instead of doing it in mon
//  calamari to build their first sd in this game!"      — rokhm1, report #763
//
// He is describing a tie the scorer could not break. Construct Factory's target
// score weighed a system by the SHAPE of its resource icons (#748: square 3,
// circle 2, triangle 1). Sullust is ground-triangle + ground-square; Mon
// Calamari is space-triangle + space-square. Both come to 4. Identical. The
// pick fell to the tie-break, and it landed on the wrong one.
//
// But a square is not one thing: in space it is a Star Destroyer — 6 transport
// capacity, and the unit the whole #748/#738 "the Empire never builds capital
// ships" thread is about — while on the ground it is an AT-AT that something
// else has to carry. His own log shows the rest: the Sullust build came back
// picks:["stormtrooper", null]. The square icon built NOTHING, because the
// AT-AT supply was already empty, exactly as he said.
//
// The fix prices an icon by what it would REALLY yield, on the terms the
// engine accepts (resolveBuildFromIconsPick): matching theater, exact tier,
// our side, not project-only, and a mini left in supply. An icon that can
// build nothing is worth nothing.
//
// Run: node scripts/test-build-yield-targeting-763.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { register } = await import('tsx/esm/api'); register();
const { createGame } = await import('../src/engine/setup.ts');
const ai = await import('../src/play/randomAI.ts');

const j = (p) => JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf8'));
const data = {
  systems: j('systems.json'), adjacency: j('adjacency.json'), leaders: j('leaders.json'),
  actions: j('actions.json'), missions: j('missions.json'), objectives: j('objectives.json'),
  tactics: j('tactics.json'), probes: j('probes.json'),
};

let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };

const MID = 'construct-factory';

function board() {
  const G = createGame(data, { seed: 763, autoSetupUnits: true, expansion: { enabled: true, roeUnits: true } });
  // Both worlds Imperial, so both are legal targets ("Resolve in any Imperial
  // system") — the state the reporter described ("they have utapau and mon cal
  // now").
  for (const sid of ['sullust', 'mon-calamari']) {
    G.map.systems[sid].loyalty = 'imperial';
    G.map.systems[sid].subjugated = false;
    G.map.systems[sid].sabotage = false;
  }
  return G;
}
const score = (G, sid) => ai.empireMissionTargetScore(G, MID, sid);

const mech = await import('../src/engine/mechanics.ts');

/** Empty a unit type's supply by parking its whole allotment on the board. */
function exhaust(G, typeId) {
  const t = G.catalog.unitTypes[typeId];
  const ss = G.map.systems['coruscant'];
  let n = 0;
  while (mech.unitsAvailableInSupply(G, typeId) > 0) {
    ss.units.push({ instanceId: `ex-${typeId}-${n}`, typeId, side: t.side });
    n++;
    if (n > 50) break; // never spin on a supply model that stops decrementing
  }
  return n;
}

console.log('\n[ the tie the old rule could not break ]');
{
  const G = board();
  const sullust = G.catalog.systems['sullust'].resources.map((r) => `${r.type}-${r.shape}`).join(' + ');
  const moncal = G.catalog.systems['mon-calamari'].resources.map((r) => `${r.type}-${r.shape}`).join(' + ');
  console.log(`    sullust      = ${sullust}`);
  console.log(`    mon-calamari = ${moncal}`);
  const shapeOnly = (sid) => G.catalog.systems[sid].resources.reduce(
    (a, r) => a + (r.shape === 'square' ? 3 : r.shape === 'circle' ? 2 : 1), 0);
  check('under shape alone the two worlds are indistinguishable',
    shapeOnly('sullust') === shapeOnly('mon-calamari'),
    `${shapeOnly('sullust')} vs ${shapeOnly('mon-calamari')}`);
}

console.log('\n[ the reporter\'s pick now wins ]');
{
  const G = board();
  const s = score(G, 'sullust'), m = score(G, 'mon-calamari');
  console.log(`    sullust ${s.toFixed(1)}   mon-calamari ${m.toFixed(1)}`);
  check('Mon Calamari (Star Destroyer) now outscores Sullust (AT-AT)', m > s,
    `${m.toFixed(1)} vs ${s.toFixed(1)}`);
}

// Also the guard on iconBuildValue's cache. The six (theater, shape) answers
// are cached across the candidate systems the scorer walks, validated by a
// board fingerprint. An earlier version keyed the cache on `turnLog.length`
// instead, on the theory that anything changing supply logs an event — and
// THIS block caught it, because exhausting the supply below pushes units
// straight onto a system and logs nothing. Keep the direct push: it is the
// cheapest available test that the cache notices a board it did not expect.
console.log('\n[ an icon with no supply left is worth nothing ]');
{
  const G = board();
  const before = score(G, 'sullust');
  const n = exhaust(G, 'at-at');
  console.log(`    parked ${n} AT-ATs — supply now ${mech.unitsAvailableInSupply(G, 'at-at')}`);
  check('the AT-AT supply is genuinely empty', mech.unitsAvailableInSupply(G, 'at-at') === 0);
  const after = score(G, 'sullust');
  console.log(`    sullust ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  check('Sullust is worth strictly less once its square icon can build nothing',
    after < before, `${after.toFixed(1)} vs ${before.toFixed(1)}`);
  check('and it still loses to Mon Calamari', score(G, 'mon-calamari') > after);
}

console.log('\n[ the lever restores the old shape-only rule ]');
{
  process.env.SWR_BUILD_YIELD = '0';
  const mod = await import(`../src/play/randomAI.ts?nocache=${Date.now()}`);
  const G = board();
  const s = mod.empireMissionTargetScore(G, MID, 'sullust');
  const m = mod.empireMissionTargetScore(G, MID, 'mon-calamari');
  delete process.env.SWR_BUILD_YIELD;
  console.log(`    with SWR_BUILD_YIELD=0: sullust ${s.toFixed(1)}  mon-calamari ${m.toFixed(1)}`);
  check('the old rule scores the two the same — the bug the reporter saw',
    Math.abs(s - m) < 0.001, `${s.toFixed(1)} vs ${m.toFixed(1)}`);
}

console.log(fail === 0 ? `\nALL PASS — ${pass} passed, 0 failed` : `\nFAILURES — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
