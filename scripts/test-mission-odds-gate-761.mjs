// "the imps just tried to capture my leader with general tagge while I had
//  riekaan and saw gerrera on dagobah - that is trying to capture me 1 vs
//  2+2green, which is not at all a sensible try. had he just waited for an
//  infiltration, he could have had a chance (1 vs 0)."   — rokhm1, report #761
//
// He read the dice correctly. Tagge is 1 major SpecOps icon; Rieekan is 1 and
// Saw Gerrera is 1 major + 2 minor, so the Empire rolled ONE die into FOUR.
// That attempt lands 6.6% of the time, and the AI played it over every
// alternative on the board.
//
// The cause was that the scorer never looked at the attacker's side of the
// roll. `oppositionTargetTerm` priced the defence alone — a flat -2 for "a
// leader is standing there", then -2 per matching skill icon — so one die and
// five dice bought the same -6, and Capture Rebel Operative's calibrated base
// value of 8.6 walked through it. The logged decision scored exactly 8.6.
//
// The fix prices a CONTESTED attempt by expected value: the exact P(success)
// from the same dice the engine is about to roll, multiplied into the reveal
// score. An UNOPPOSED attempt auto-succeeds (RAW rr p.8) and is untouched — it
// is the reporter's own "had he just waited ... 1 vs 0".
//
// Run: node scripts/test-mission-odds-gate-761.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { register } = await import('tsx/esm/api'); register();
const { createGame } = await import('../src/engine/setup.ts');
const phases = await import('../src/engine/phases.ts');
const ai = await import('../src/play/randomAI.ts');

const j = (p) => JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf8'));
const data = {
  systems: j('systems.json'), adjacency: j('adjacency.json'), leaders: j('leaders.json'),
  actions: j('actions.json'), missions: j('missions.json'), objectives: j('objectives.json'),
  tactics: j('tactics.json'), probes: j('probes.json'),
};

let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

const MID = 'capture-rebel-operative';
const SYS = 'dagobah';

/** rokhm1's board: Tagge assigned to Capture Rebel Operative, an Imperial
 *  trooper at Dagobah so the mission has a legal target there, and the two
 *  Rebel leaders he actually had standing on it. */
function board({ defenders = ['general-rieekan', 'saw-gerrera'] } = {}) {
  const G = createGame(data, { seed: 761, autoSetupUnits: true, expansion: { enabled: true, roeUnits: true } });
  G.phase = 'Command';
  G.currentPlayer = 'Empire';
  G.rebel.leadersOnBoard = {};
  G.empire.leadersOnBoard = {};
  if (defenders.length) G.rebel.leadersOnBoard[SYS] = [...defenders];
  for (const lid of defenders) {
    G.rebel.leaderPool = G.rebel.leaderPool.filter((l) => l !== lid);
  }
  // An Imperial unit at Dagobah — Capture Rebel Operative needs one there.
  const ss = G.map.systems[SYS];
  ss.units = (ss.units ?? []).filter((u) => u.side !== 'Empire');
  ss.units.push({ instanceId: 'e-test-1', typeId: 'stormtrooper', side: 'Empire' });
  // Tagge, alone, on the mission — the report's exact assignment.
  G.empire.leaderPool = G.empire.leaderPool.filter((l) => l !== 'general-tagge');
  G.empire.leadersOnMissions = [{ missionId: MID, leaderIds: ['general-tagge'] }];
  G.empire.missionHand = (G.empire.missionHand ?? []).filter((m) => m !== MID);
  return G;
}

const revealAt = (G, sysId) => ai.bestCommandAction(G, 'Empire')
  .filter((a) => a.kind === 'reveal' && a.missionId === MID && a.targetSystemId === sysId)[0] ?? null;

console.log('\n[ the dice the reporter counted ]');
{
  const G = board();
  const pre = phases.missionDicePreview(G, 'Empire', MID, SYS, ['general-tagge']);
  check('attacker rolls 1 die (Tagge, 1 major SpecOps)',
    pre.attMajor === 1 && pre.attMinor === 0, JSON.stringify(pre));
  check('opposition rolls 2 major + 2 green (Rieekan + Saw Gerrera)',
    pre.oppMajor === 2 && pre.oppMinor === 2, JSON.stringify(pre));
}

console.log('\n[ the odds, exactly ]');
{
  const G = board();
  const p = ai.missionAttemptOdds(G, 'Empire', MID, SYS, ['general-tagge']);
  console.log(`    P(success) = ${(p * 100).toFixed(1)}%`);
  // Hand-computed: P(opp=0)=4/81, P(opp=1)=16/81; P(att>=1)=2/3, P(att=2)=1/6.
  check('1-vs-2+2green lands about 6.6% of the time', near(p, (4 / 81) * (2 / 3) + (16 / 81) * (1 / 6)),
    p.toFixed(4));
  check('it is a long shot by any reading', p < 0.1, p.toFixed(4));
}

console.log('\n[ the reporter\'s own counterfactual: 1 vs 0 ]');
{
  const G = board({ defenders: [] });
  const p = ai.missionAttemptOdds(G, 'Empire', MID, SYS, ['general-tagge']);
  check('an UNOPPOSED attempt is priced at 1.0 (RAW auto-success, rr p.8)', p === 1, String(p));
}

console.log('\n[ a leader with no MATCHING icons still opposes ]');
{
  // Mon Mothma has 0 SpecOps. She rolls nothing, but she is standing there, so
  // the engine does not auto-succeed — the attacker must still out-roll a zero.
  const G = board({ defenders: ['mon-mothma'] });
  const pre = phases.missionDicePreview(G, 'Empire', MID, SYS, ['general-tagge']);
  const p = ai.missionAttemptOdds(G, 'Empire', MID, SYS, ['general-tagge']);
  check('she contributes 0 dice', pre.oppMajor === 0 && pre.oppMinor === 0, JSON.stringify(pre));
  check('but it is NOT an auto-success — 1 die beating 0 is 2/3', near(p, 2 / 3), p.toFixed(4));
}

console.log('\n[ the decision the report is about ]');
{
  const G = board();
  const withGate = revealAt(G, SYS);
  check('the reveal is still generated (never suppressed outright)', !!withGate);
  console.log(`    reveal score with the gate: ${withGate.score.toFixed(2)}`);
  check('a 6.6% attempt no longer scores like a sure thing', withGate.score < 1.5,
    withGate.score.toFixed(2));

  // Everything else the Empire could do this turn.
  const others = ai.bestCommandAction(G, 'Empire').filter((a) => a !== withGate && a.kind !== 'pass');
  const bestOther = Math.max(...others.map((a) => a.score));
  check('it now loses to the best alternative on the board', withGate.score < bestOther,
    `reveal ${withGate.score.toFixed(2)} vs best other ${bestOther.toFixed(2)}`);

  // ...but it still beats doing nothing: revealing lands the leader and cycles
  // a dead card, so a gate that pushed it under `pass` would feed the AI's
  // oldest failure mode (#581/#617/#629 "passed with plays available").
  const passAct = ai.bestCommandAction(G, 'Empire').find((a) => a.kind === 'pass');
  check('but still beats passing outright', withGate.score > passAct.score,
    `reveal ${withGate.score.toFixed(2)} vs pass ${passAct.score.toFixed(2)}`);
}

console.log('\n[ an unopposed target keeps its full score ]');
{
  // Capture Rebel Operative can never BE unopposed — it targets a Rebel leader,
  // so one is always standing on the target. Use a mission that can be: Rule By
  // Fear, an ordinary diplomacy attempt, aimed at a system with no Rebel leader.
  const RBF = 'rule-by-fear';
  const G = board({ defenders: [] });
  G.empire.leaderPool = G.empire.leaderPool.filter((l) => l !== 'emperor-palpatine');
  G.empire.leadersOnMissions = [{ missionId: RBF, leaderIds: ['emperor-palpatine'] }];
  G.empire.missionHand = (G.empire.missionHand ?? []).filter((m) => m !== RBF);
  const reveals = ai.bestCommandAction(G, 'Empire').filter((a) => a.kind === 'reveal' && a.missionId === RBF);
  check('the Empire has Rule By Fear reveals to choose from', reveals.length > 0);
  const undefended = reveals.filter((r) => (G.rebel.leadersOnBoard[r.targetSystemId] ?? []).length === 0);
  check('all of them are at systems with no Rebel leader', undefended.length === reveals.length);
  // Priced identically with the gate on and off: p = 1 multiplies nothing away.
  process.env.SWR_MISSION_ODDS = '0';
  const modOff = await import(`../src/play/randomAI.ts?nocache=${Date.now()}-rbf`);
  const offScores = modOff.bestCommandAction(G, 'Empire')
    .filter((a) => a.kind === 'reveal' && a.missionId === RBF)
    .map((a) => `${a.targetSystemId}:${a.score.toFixed(3)}`).sort().join(',');
  delete process.env.SWR_MISSION_ODDS;
  const onScores = reveals.map((a) => `${a.targetSystemId}:${a.score.toFixed(3)}`).sort().join(',');
  check('an unopposed attempt scores the same with the gate on and off',
    onScores === offScores, `on=${onScores} off=${offScores}`);
}

console.log('\n[ the lever restores the old behaviour ]');
{
  process.env.SWR_MISSION_ODDS = '0';
  const mod = await import(`../src/play/randomAI.ts?nocache=${Date.now()}`);
  const G = board();
  const off = mod.bestCommandAction(G, 'Empire')
    .filter((a) => a.kind === 'reveal' && a.missionId === MID && a.targetSystemId === SYS)[0];
  delete process.env.SWR_MISSION_ODDS;
  console.log(`    with SWR_MISSION_ODDS=0: ${off.score.toFixed(2)}`);
  check('the old score is the undiscounted one', off.score > 5, off.score.toFixed(2));
  check('which is exactly the bug the reporter saw', off.score > 5, off.score.toFixed(2));
}

console.log(fail === 0 ? `\nALL PASS — ${pass} passed, 0 failed` : `\nFAILURES — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
