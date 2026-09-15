// @timeout 120000
// Voluntary Rebel base reveal (FAQ, "Rebel Base"; BGG report, September 2026).
//
// A player asked how to reveal his base on purpose: "the Death Star orbiting
// Yavin planning to blow up the rebel base necessitates revealing the base to
// get Luke into his x-wing." There was no way to. The FAQ allows it:
//   "If the Rebel player wishes to optionally reveal his base, he can only do
//    so at the start of one of his turns of the Command Phase, either before
//    using one of his leaders or passing."
//   "If the Imperial player has a Death Star ... in the same system as the
//    hidden Rebel base, is the base automatically revealed? No. The Rebel base
//    is revealed only if the Imperial player moves ground units into the system."
//   "If the Rebel player reveals the base on his turn and there are already
//    Imperial units in the system, do they immediately resolve a combat? Yes."
//   "Can the Rebel player voluntarily reveal his base even after he has passed?
//    No."
//
// The trap this pins: any combat that ends during the Command phase hands the
// turn to the opponent (finishCombatTail). A voluntary reveal is NOT the
// Rebel's command action, so its combat must not spend his turn. The control
// runs the same fight without the flag and shows the hand-off does happen.
// Run: node scripts/test-voluntary-base-reveal.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { register } = await import('tsx/esm/api'); register();
const { createGame } = await import('../src/engine/setup.ts');
const M = await import('../src/engine/mechanics.ts');
const phases = await import('../src/engine/phases.ts');
const combat = await import('../src/engine/combat.ts');
const ai = await import('../src/play/randomAI.ts');
const { rebellionAdapter } = await import('../src/adapter/rebellionAdapter.ts');
const j = (p) => JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf8'));
const data = { systems: j('systems.json'), adjacency: j('adjacency.json'), leaders: j('leaders.json'), actions: j('actions.json'), missions: j('missions.json'), objectives: j('objectives.json'), tactics: j('tactics.json'), probes: j('probes.json') };
let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };
let k = 0;
const unit = (typeId, side) => ({ instanceId: `vr${k++}`, typeId, side, damage: 0 });

/** Rebel's Command turn, hidden base, nothing pending. `inBaseSpace` go into the
 *  off-board Rebel Base space; `imperialAtBase` into the base's real system. */
function board({ inBaseSpace = [], imperialAtBase = [], seed = 11 } = {}) {
  const G = createGame(data, { seed, autoSetupUnits: true });
  for (const ss of Object.values(G.map.systems)) ss.units = [];
  G.map.rebelBaseSpace.units = [];
  G.rebel.leadersOnBoard = {}; G.empire.leadersOnBoard = {};
  G.rebel.objectiveHand = []; // keep Death Star Plans prompts out of the fight
  G.rebelBaseRevealed = false;
  G.phase = 'Command'; G.currentPlayer = 'Rebel'; G.passedThisCommand = [];
  G.pendingMission = undefined; G.pendingChoice = undefined; G.pendingCombat = undefined;
  G.isGameOver = false; G.winner = undefined;
  const base = G.rebelBaseSystemId;
  for (const t of inBaseSpace) G.map.rebelBaseSpace.units.push(unit(t, 'Rebel'));
  for (const t of imperialAtBase) G.map.systems[base].units.push(unit(t, 'Empire'));
  return { G, base };
}
/** Drive whatever combat/choices are open to completion with the heuristic AI. */
function settle(G) {
  let guard = 0;
  while ((G.pendingCombat || G.pendingChoice) && guard++ < 800 && !G.isGameOver) {
    const owner = G.pendingChoice?.side;
    const order = owner ? [owner, owner === 'Rebel' ? 'Empire' : 'Rebel'] : ['Rebel', 'Empire'];
    if (ai.stepOnce(G, order[0])) continue;
    if (ai.stepOnce(G, order[1])) continue;
    break;
  }
  return !G.pendingCombat && !G.pendingChoice;
}
const revealLog = (G) => (G.turnLog ?? []).filter((e) => e.kind === 'reveal-base');

console.log('[ FAQ premise: a Death Star alone never reveals the base ]');
{
  const { G } = board({ imperialAtBase: ['death-star'] });
  M.recomputeRebelBaseReveal(G);
  check('a Death Star in the base system leaves the base hidden', G.rebelBaseRevealed === false);
  const g2 = board({ imperialAtBase: ['stormtrooper'] }).G;
  M.recomputeRebelBaseReveal(g2);
  check('control: an Imperial GROUND unit there does reveal it (so the gap is real)', g2.rebelBaseRevealed === true);
}

console.log('[ the reported scenario: ships in the Rebel Base space, Death Star at the base ]');
{
  const { G, base } = board({ inBaseSpace: ['x-wing', 'corellian-corvette'], imperialAtBase: ['death-star'] });
  const r = phases.revealRebelBaseVoluntarily(G, 'Rebel');
  check('the reveal is accepted on the Rebel\'s Command turn', r.ok === true, JSON.stringify(r));
  check('the base is now revealed', G.rebelBaseRevealed === true);
  check('the X-wing and corvette moved out of the Rebel Base space into the real system',
    G.map.rebelBaseSpace.units.length === 0
      && ['x-wing', 'corellian-corvette'].every((t) => G.map.systems[base].units.some((u) => u.side === 'Rebel' && u.typeId === t)),
    JSON.stringify(G.map.systems[base].units.map((u) => u.typeId)));
  check('it is logged publicly as a voluntary reveal', revealLog(G).some((e) => e.payload?.reason === 'voluntary'));
  const fought = !!G.pendingCombat || (G.turnLog ?? []).some((e) => e.kind === 'combat-begin' && e.payload?.systemId === base);
  check('combat against the Death Star starts immediately (FAQ)', fought);
  check('the reveal did not spend the Rebel\'s turn', G.currentPlayer === 'Rebel' && !G.passedThisCommand.includes('Rebel'));
}

console.log('[ the turn survives a COMPLETED combat — the trap ]');
{
  const { G } = board({ inBaseSpace: ['x-wing', 'x-wing', 'corellian-corvette'], imperialAtBase: ['tie-fighter'] });
  const r = phases.revealRebelBaseVoluntarily(G, 'Rebel');
  check('reveal accepted', r.ok === true, JSON.stringify(r));
  const done = settle(G);
  check('the combat ran to completion', done && !G.isGameOver, `pendingCombat=${!!G.pendingCombat} choice=${G.pendingChoice?.kind}`);
  check('after the fight it is STILL the Rebel\'s Command turn', G.phase === 'Command' && G.currentPlayer === 'Rebel',
    `phase=${G.phase} current=${G.currentPlayer}`);
  // NON-VACUOUS: the identical fight started the ordinary way (no flag) hands
  // the turn to the Empire when it ends — that is what the flag suppresses.
  const c = board({ inBaseSpace: ['x-wing', 'x-wing', 'corellian-corvette'], imperialAtBase: ['tie-fighter'] });
  M.revealRebelBase(c.G, 'test-control');
  combat.beginCombat(c.G, 'Rebel', c.base, c.base);
  combat.runCombat(c.G);
  const cDone = settle(c.G);
  check('control: without the flag the same fight ends and hands the turn to the Empire',
    cDone && c.G.currentPlayer === 'Empire', `done=${cDone} current=${c.G.currentPlayer}`);
}

console.log('[ other outcomes ]');
{
  const { G, base } = board({ inBaseSpace: ['rebel-trooper'] });
  const r = phases.revealRebelBaseVoluntarily(G, 'Rebel');
  check('with no Imperials present: revealed, no combat, turn kept',
    r.ok && G.rebelBaseRevealed && !G.pendingCombat && G.currentPlayer === 'Rebel'
      && G.map.systems[base].units.some((u) => u.typeId === 'rebel-trooper'),
    JSON.stringify(r));
  const e = board({ imperialAtBase: ['death-star'] }).G;
  const re = phases.revealRebelBaseVoluntarily(e, 'Rebel');
  check('RAW: revealing an EMPTY base onto Imperial units loses the game for the Rebel',
    re.ok && e.isGameOver && e.winner === 'Empire', `over=${e.isGameOver} winner=${e.winner}`);
}

console.log('[ refused when the FAQ says no ]');
{
  const t = (mut, reason, label) => {
    const { G } = board({ inBaseSpace: ['x-wing'] }); mut(G);
    const side = G.__side ?? 'Rebel';
    const r = phases.revealRebelBaseVoluntarily(G, side);
    check(`${label} → ${reason}`, r.ok === false && String(r.reason).startsWith(reason), JSON.stringify(r));
    check(`  …and the base stays hidden`, G.rebelBaseRevealed === false || reason === 'already-revealed');
  };
  t((G) => { G.passedThisCommand = ['Rebel']; }, 'already-passed', 'after the Rebel has passed');
  t((G) => { G.phase = 'Assignment'; }, 'wrong-phase', 'outside the Command phase');
  t((G) => { G.currentPlayer = 'Empire'; }, 'not-your-turn', 'on the Empire\'s turn');
  t((G) => { G.currentPlayer = 'Empire'; G.__side = 'Empire'; }, 'rebel-only', 'by the Empire');
  t((G) => { G.pendingChoice = { kind: 'Choice', side: 'Rebel' }; }, 'choice-pending', 'while a choice is open');
  t((G) => { G.rebelBaseRevealed = true; }, 'already-revealed', 'when already revealed');
}

console.log('[ online play: the adapter carries it, purely ]');
{
  const { G } = board({ inBaseSpace: ['x-wing'] });
  const before = G.rebelBaseRevealed;
  const r = rebellionAdapter.tryApplyAction(G, { kind: 'revealRebelBase' }, 'Rebel');
  check('tryApplyAction(revealRebelBase) succeeds for the Rebel seat', r.ok === true, String(r.reason));
  check('the returned state is revealed', r.state.rebelBaseRevealed === true);
  check('the input state was not mutated (adapter is pure)', G.rebelBaseRevealed === before);
  const bad = rebellionAdapter.tryApplyAction(board({ inBaseSpace: ['x-wing'] }).G, { kind: 'revealRebelBase' }, 'Empire');
  check('the Empire seat is refused', bad.ok === false);
}

console.log('[ tripwires ]');
{
  const src = (p) => readFileSync(join(ROOT, p), 'utf8');
  check('the online shim overrides it (else it runs on the redacted local view and soft-locks)',
    /revealRebelBaseVoluntarily:\s*\(_g: any, _s: any\) => act\(\{ kind: 'revealRebelBase' \}\)/.test(src('src/online/onlineEngine.ts')));
  const pt = src('src/play/PlayTab.tsx');
  check('the Command panel offers a "Reveal base" button to the Rebel while hidden',
    /side === 'Rebel' && !G\.rebelBaseRevealed && onRevealBase/.test(pt) && />Reveal base<\/button>/.test(pt));
  check('the hand-off guard reads the flag', /!c\.flags\?\.voluntaryRevealNoHandoff/.test(src('src/engine/combat.ts')));
}
console.log(fail === 0 ? `\nALL PASS — ${pass} passed, 0 failed` : `\nFAILURES — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
