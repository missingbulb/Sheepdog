#!/usr/bin/env node
// Claude Code Stop hook: run the conformance checks on what the session changed
// and block the stop (exit 2) while blocking findings remain, feeding them back
// into the session. Registered per-repo — see bootstrap.md.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hooklog } from './helpers/hook-log.mjs';

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const runner = join(dirname(fileURLToPath(import.meta.url)), 'check_the_world.mjs');

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
const run = spawnSync(process.execPath, [runner, ...(transcriptPath ? ['--transcript', transcriptPath] : [])], {
  cwd: projectRoot, encoding: 'utf8',
});
if (run.status === 0) {
  if (run.stdout.trim()) console.log(run.stdout.trim()); // advisory findings, for the transcript
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
const hash = createHash('sha256').update(run.stdout).digest('hex').slice(0, 16);
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
  console.log('claudinite checks: the same blocking findings survived 2 fix attempts — letting the stop through. Run `node ' + runner + '` to see them.');
  hooklog('Stop', 'done exit=0 loop-guard-relent');
  process.exit(0);
}

process.stderr.write(
  runnerFailed
    ? `Claudinite checks could not run — the check runner failed to launch: ${run.error?.message || 'abnormal exit'}. Fix the runner before relying on Stop-hook enforcement.`
    : 'Claudinite conformance checks failed — fix these findings now, in this session:\n\n' + run.stdout
);
hooklog('Stop', `done exit=2 ${runnerFailed ? 'runner-error' : 'blocking-findings'}`);
process.exit(2);
