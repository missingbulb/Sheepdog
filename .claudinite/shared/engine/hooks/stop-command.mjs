// The one Stop command a consumer's .claude/settings.json wires. The settings
// file must be as clean as possible and change as seldom as possible (#385), so
// this address is the stable contract. It gates — fast-exiting when the session
// changed nothing — then runs the WORK sweep (../checks/check_the_work.mjs: the
// rules judging this change, with the session transcript) and blocks the stop
// (exit 2) while blocking findings remain, feeding them back into the session.
// The WORLD sweep (repo-state rules) does NOT run here — it runs in the
// project's test/CI flow (bootstrap wires `check_the_world.mjs` in as its own
// step; see engine/checks/README.md "Enforcement wiring").
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hooklog } from '../checks/helpers/hook-log.mjs';

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const workRunner = join(dirname(fileURLToPath(import.meta.url)), '..', 'checks', 'check_the_work.mjs');

const git = (...a) => spawnSync('git', a, { cwd: projectRoot, encoding: 'utf8' });

// Fast path: nothing changed vs the base and the tree is clean → stay silent.
const status = git('status', '--porcelain');
let dirty = status.status === 0 && status.stdout.trim() !== '';
if (!dirty) {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const mb = git('merge-base', 'HEAD', ref);
    if (mb.status !== 0) continue;
    dirty = git('rev-parse', 'HEAD').stdout.trim() !== mb.stdout.trim();
    break;
  }
}
if (!dirty) process.exit(0); // clean fast path — nothing ran, nothing to log

// Claude Code passes the hook's input JSON on stdin; its transcript_path is what
// lets the conversation-surface rules see the session. A manual run (TTY, or no
// parseable input) simply runs without them — they self-skip on a null transcript.
let transcriptPath = null;
try {
  if (!process.stdin.isTTY) {
    const input = readFileSync(0, 'utf8');
    if (input.trim()) transcriptPath = JSON.parse(input).transcript_path ?? null;
  }
} catch { /* no usable hook input — conversation rules self-skip */ }

hooklog('Stop', 'start checks');
const run = spawnSync(process.execPath, [workRunner, ...(transcriptPath ? ['--transcript', transcriptPath] : [])], {
  cwd: projectRoot, encoding: 'utf8',
});
const output = (run.stdout ?? '').trim();
if (run.status === 0) {
  if (output) console.log(output); // advisory findings, for the transcript
  hooklog('Stop', 'done exit=0 checks-passed');
  process.exit(0);
}

// The runner itself failing to launch is not a real finding — but don't pass
// silently: surface it and still block, so a broken enforcement setup can't wave
// sessions through unnoticed. The loop guard below keeps a persistent failure
// from wedging the session.
const runnerFailed = Boolean(run.error) || typeof run.status !== 'number';

// Self-limiting loop guard: after blocking twice on the *same* findings, let the
// stop through rather than trapping a session that can't converge.
const hash = createHash('sha256').update(output).digest('hex').slice(0, 16);
const stateFile = join(
  tmpdir(),
  `claudinite-stop-${createHash('sha256').update(projectRoot).digest('hex').slice(0, 12)}.json`
);
let state = { hash: '', count: 0 };
if (existsSync(stateFile)) {
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* stale state resets below */ }
}
const count = state.hash === hash ? state.count + 1 : 1;
writeFileSync(stateFile, JSON.stringify({ hash, count }));
if (count > 2) {
  console.log('claudinite checks: the same blocking findings survived 2 fix attempts — letting the stop through. Run `node ' + workRunner + '` to see them.');
  hooklog('Stop', 'done exit=0 loop-guard-relent');
  process.exit(0);
}

process.stderr.write(
  runnerFailed
    ? `Claudinite checks could not run — the check runner failed to launch: ${run.error?.message || 'abnormal exit'}. Fix the runner before relying on Stop-hook enforcement.`
    : 'Claudinite conformance checks failed — fix these findings now, in this session:\n\n' + output + '\n'
);
hooklog('Stop', `done exit=2 ${runnerFailed ? 'runner-error' : 'blocking-findings'}`);
process.exit(2);
