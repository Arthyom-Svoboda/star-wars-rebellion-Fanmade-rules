// #771 — "The Rebel base has been revealed, then they played Rapid
// Mobilization … the leaders should be placed on the system, but currently they
// are placed on the Rebel Base space."
//
// RR p.11 (Revealing the Rebel Base): "After the Rebel base is revealed, the
// Rebel player can still establish a new base. Leaders resolving this mission
// are placed in the Rebel base's system instead of the 'Rebel Base' space." and
// "Any leaders or units that would be placed (not deployed) here are instead
// placed in the system shown on the faceup probe card." The same redirect
// covers Rebel Planning ("Place this leader in the 'Rebel Base' space").
//
// Run: node scripts/test-revealed-base-placement-771.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { register } = await import('tsx/esm/api'); register();
const { createGame } = await import('../src/engine/setup.ts');
const phases = await import('../src/engine/phases.ts');
const { missionTargets } = await import('../src/engine/missionTargets.ts');

const j = (p) => JSON.parse(readFileSync(join(ROOT, 'assets', p), 'utf8'));
const data = {
  systems: j('systems.json'), adjacency: j('adjacency.json'), leaders: j('leaders.json'),
  actions: j('actions.json'), missions: j('missions.json'), objectives: j('objectives.json'),
  tactics: j('tactics.json'), probes: j('probes.json'),
};
let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };

const BASE = 'sullust';
const at = (G, sid, lid) => (G.rebel.leadersOnBoard[sid] ?? []).includes(lid);

/** Assign Mon Mothma to Rapid Mobilization and reveal it; `revealed` toggles the base. */
function playRM(revealed) {
  const G = createGame(data, { seed: 771, forcedBaseSystem: BASE });
  G.rebelBaseRevealed = revealed;
  G.rebel.leadersOnBoard = {};
  if (!G.rebel.leaderPool.includes('mon-mothma')) G.rebel.leaderPool.push('mon-mothma');
  G.rebel.actionHand = []; G.empire.actionHand = [];
  G.phase = 'Assignment'; G.currentPlayer = 'Rebel'; G.passedThisCommand = [];
  G.rebel.missionHand = ['rapid-mobilization'];
  const asg = phases.assignLeader(G, 'Rebel', 'rapid-mobilization', ['mon-mothma']);
  if (!asg.ok) return { G, error: `assign:${asg.reason}` };
  G.phase = 'Command';
  const targets = missionTargets(G, 'Rebel', 'rapid-mobilization');
  const rv = phases.revealMission(G, 'Rebel', 'rapid-mobilization', targets.systemIds[0]);
  return { G, targets, error: rv.ok ? null : `reveal:${rv.reason}` };
}

console.log('\n[ #771 base REVEALED: Rapid Mobilization leaders go to the base system ]');
{
  const { G, targets, error } = playRM(true);
  check('reveal succeeded', !error, error);
  check('the only target is the revealed base system', JSON.stringify(targets.systemIds) === JSON.stringify([BASE]),
    JSON.stringify(targets.systemIds));
  check('Mon Mothma is in the base system', at(G, BASE, 'mon-mothma'), JSON.stringify(G.rebel.leadersOnBoard));
  check('Mon Mothma is NOT on the Rebel Base space', !at(G, 'rebel-base-space', 'mon-mothma'));
  check('the mission is still queued for end of phase', (G.pendingRapidMobilizations ?? []).length === 1);
}

console.log('\n[ control: base HIDDEN keeps the leader on the Rebel Base space ]');
{
  const { G, targets, error } = playRM(false);
  check('reveal succeeded', !error, error);
  check('target is the Rebel Base space', targets.systemIds[0] === 'rebel-base-space', JSON.stringify(targets.systemIds));
  check('Mon Mothma is on the Rebel Base space', at(G, 'rebel-base-space', 'mon-mothma'));
  check('Mon Mothma is NOT on the map at the hidden base', !at(G, BASE, 'mon-mothma'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
