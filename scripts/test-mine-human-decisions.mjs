// @timeout 300000
// Tripwire for the step-1 imitation pipeline: the exact-state replayer
// (scripts/mine-human-decisions.mjs) must keep reaching the Command phase from
// archived turn-start snapshots, and the coverage instrument
// (scripts/eval-candidate-coverage.mjs) must keep reading its output.
//
// The replayer answers every Refresh/Assignment choice the engine posts with
// the recorded resolution (deploy, build, recruit, ring, hand-trim, pool cap,
// assignment incl. the #76 undo and action-card plays). Any engine change that
// renames one of those events, reorders the Refresh steps, or alters a
// resolver's contract silently breaks the dataset — this catches it.
//
// Needs logs/ (gitignored, present on the dev machine). Skips cleanly if absent.
// Run: node scripts/test-mine-human-decisions.mjs
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (n, ok, e = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + e}`); ok ? pass++ : fail++; };

const logsDir = join(ROOT, 'logs');
const haveLogs = existsSync(logsDir) && readdirSync(logsDir).some((f) => f.endsWith('.json'));
if (!haveLogs) { console.log('  (skip) no logs/ on this machine'); process.exit(0); }

// PINNED SAMPLE (2026-09-14). This used to run `--limit 12`, which takes the
// first 12 games in FILENAME order. Filenames are content hashes and players
// upload new logs constantly, so any upload whose hash sorts early displaced an
// older game from the window. On 2026-09-14 the window held zero comparable
// mission rolls, the fidelity check read "0 compared" and the suite failed with
// no code change at all (the same miner at --limit 40 read "4 compared, 0
// mismatched"). Pinning the files makes every check below independent of
// archive growth; only an ENGINE change can now move the numbers, which is the
// point of the tripwire.
//
// Chosen by scoring candidates one at a time with --files, oldest uploads first,
// ONE FILE PER GAME: the miner skips repeat gameIds, and the archive holds many
// re-uploads of the same game under different hashes (a first attempt at this
// list silently collapsed from 12 files to 8 games and a roll margin of 2).
//   - four human-EMPIRE games that each compare one replayed mission roll, so the
//     non-vacuity guard ("at least 1 compared") has a margin of four, not one;
//   - three more human-Empire games that replay cleanly;
//   - four human-REBEL games so the Rebel-first replay path stays exercised.
// At pinning (2026-09-14): 11 games, exact 65, approx 6, failed 8 (82% exact vs
// the 70% bar); samples Empire 38 exact / 3 approx, Rebel 27 / 3; mission-roll
// fidelity 4 compared, 0 mismatched. If a log here is ever deleted, score
// replacements with `mine-human-decisions.mjs --files <one>` and keep one per game.
const PINNED = [
  // human Empire, each compares a mission roll
  'c081fba1b534020f.json', '34aeb957a727b132.json', '77bea51b1030e916.json', 'f60d1eebea24871f.json',
  // human Empire, clean replay
  'ac77e6548b2ff399.json', '00e6b9d28734bf13.json', 'ce5447df9a9de3a6.json',
  // human Rebel
  'f1eb6cec2226df28.json', 'c4e3a0f6f6c7c084.json', '0f5aa7a3eb427558.json', '790e2da6f65fb0ce.json',
];
const missing = PINNED.filter((f) => !existsSync(join(logsDir, f)));
if (missing.length) { console.log(`  (skip) pinned logs absent on this machine: ${missing.join(', ')}`); process.exit(0); }
{
  // Guard the pin itself: a re-upload of an already-pinned game adds nothing
  // (the miner dedups by gameId) and would quietly shrink the sample.
  const ids = PINNED.map((f) => { try { return JSON.parse(readFileSync(join(logsDir, f), 'utf8')).gameId ?? f; } catch { return f; } });
  const dup = ids.filter((g, i) => ids.indexOf(g) !== i);
  check('pinned sample is one log per distinct game', dup.length === 0, `repeated gameIds: ${[...new Set(dup)].join(', ')}`);
}

const tmp = mkdtempSync(join(tmpdir(), 'mine-'));
const out = join(tmp, 'hd.jsonl');
console.log('[ the replayer reaches the Command phase on real archived rounds ]');
const r = spawnSync(process.execPath, [join(ROOT, 'scripts/mine-human-decisions.mjs'), '--files', PINNED.join(','), '--out', out], { cwd: ROOT, encoding: 'utf8' });
check('miner ran', r.status === 0, (r.stderr || r.stdout).slice(-400));
const m = /replayed to Command: exact (\d+) approx (\d+) failed (\d+)/.exec(r.stdout) || [];
const exact = Number(m[1] || 0), approx = Number(m[2] || 0), failed = Number(m[3] || 0);
console.log(`    exact ${exact} approx ${approx} failed ${failed}`);
check('most rounds replay EXACTLY (>= 70% of attempted)', exact / Math.max(1, exact + approx + failed) >= 0.7);
check('at least one sample was written', existsSync(out) && readFileSync(out, 'utf8').trim().length > 0);
{
  // v2 (2026-09-02): the Command stage replays the AI Rebel's opening actions
  // (reveal + opposition + mission effects, activations with their move orders)
  // so human-EMPIRE first decisions are exact too. Pin that it yields Empire
  // samples and that replayed mission dice match the recorded dice — the
  // strongest available proof that the replayed state is the recorded one.
  const rows = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  check('v2: human-Empire samples are produced', rows.some((r) => r.humanSide === 'Empire' && r.quality === 'exact'));
  const fid = /mission-roll fidelity: (\d+) compared, (\d+) mismatched/.exec(r.stdout);
  check('v2: replayed mission rolls match the recorded dice (0 mismatches)', fid && Number(fid[1]) >= 1 && Number(fid[2]) === 0, r.stdout.match(/mission-roll fidelity[^\n]*/)?.[0] ?? 'no fidelity line');
}
const rows = existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
check('samples carry state + human action + candidates + matchIndex',
  rows.length > 0 && rows.every((x) => typeof x.state === 'string' && x.humanAction?.kind && Array.isArray(x.candidates) && typeof x.matchIndex === 'number'));

console.log('[ the coverage instrument reads it ]');
const e = spawnSync(process.execPath, [join(ROOT, 'scripts/eval-candidate-coverage.mjs'), out], { cwd: ROOT, encoding: 'utf8' });
check('instrument ran', e.status === 0, (e.stderr || e.stdout).slice(-300));
check('and reports an ALL row with a coverage percentage', /^ALL\s+\d+\s+\d+%/m.test(e.stdout), e.stdout.slice(0, 200));
rmSync(tmp, { recursive: true, force: true });
console.log(fail === 0 ? `\nALL PASS — ${pass} passed, 0 failed` : `\nFAILURES — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
