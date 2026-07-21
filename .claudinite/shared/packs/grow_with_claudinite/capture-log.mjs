#!/usr/bin/env node
// The merge-to-main capture step (grow_with_claudinite pack): push this session's
// conversation onto the repo's orphan `conversation-logs` branch as one JSONL
// file named `<stamp>--issue-<n>--<session>.jsonl` (README.md owns the standard).
//
// Delta-aware: a session that merges more than once pushes a second, disjoint
// file holding only the entries after its previous capture — each file maps 1:1
// to a merge and its issue, so the nightly extract never re-reads a turn.
//
// All branch writes go through git plumbing (hash-object/mktree/commit-tree/push)
// against the fetched remote tip — the user's checkout and index are never
// touched, and there is no worktree to clean up.
//
// Usage (from the repo root, right after the merge lands):
//   node capture-log.mjs --issue <n> [--transcript <path>] [--branch <name>] [--session <id>]
//
// The session id (CLAUDE_CODE_SESSION_ID, or --session) names the transcript file
// exactly, so discovery searches every project directory for it — a remote/web
// session's transcript can land under a slug the git-root path never reproduces.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BRANCH = 'conversation-logs';

// --- pure helpers (exported for pack.test.mjs) -------------------------------

// Split a transcript into { raw, entry } pairs, preserving the original line
// bytes — the capture must stay byte-faithful (re-encoding could reorder or
// reformat), so raw is what gets written and entry is only read for slicing.
// (checks/lib/transcript.mjs parseEntries returns parsed objects only, which is
// right for conversation rules but loses the fidelity capture needs.)
export function parseLines(text) {
  const out = [];
  for (const raw of (text || '').split('\n')) {
    if (!raw.trim()) continue;
    try { out.push({ raw, entry: JSON.parse(raw) }); } catch { /* partial trailing write — skip */ }
  }
  return out;
}

// Merge the main transcript with any sidechain streams into one timestamp-ordered
// list. A timestampless entry (queue markers and the like) inherits its stream
// predecessor's timestamp so it stays glued to its neighbors through the merge.
export function bundleStreams(streams) {
  const tagged = [];
  streams.forEach((lines, s) => {
    let carry = '';
    lines.forEach((line, i) => {
      if (typeof line.entry.timestamp === 'string') carry = line.entry.timestamp;
      tagged.push({ raw: line.raw, entry: line.entry, ts: carry, s, i });
    });
  });
  return tagged
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.s - b.s || a.i - b.i))
    .map(({ raw, entry, ts }) => ({ raw, entry, ts }));
}

// Entries strictly after `lastTs` (ISO strings compare lexicographically) — the
// delta a twice-merging session captures. null lastTs = no prior capture = all.
export function sliceAfter(bundled, lastTs) {
  if (!lastTs) return bundled;
  return bundled.filter((l) => l.ts > lastTs);
}

export function maxTimestamp(bundled) {
  let max = null;
  for (const l of bundled) if (l.ts && (!max || l.ts > max)) max = l.ts;
  return max;
}

// Scrubbing is enumeration-first: a transcript records tool output verbatim and
// the harness redacts nothing, so every value the capturing environment holds
// (process.env, known credential stores) is redacted wherever it appears —
// whatever its shape — because a pattern list is guaranteed to miss shapes it
// never heard of. Fail-safe direction: a variable the allowlist doesn't name is
// redacted; the allowlist names only structural values (paths, locale, CI
// metadata) that saturate a transcript, where redaction would mangle the log
// without protecting anything.
const STRUCTURAL_ENV = new Set([
  'PATH', 'HOME', 'PWD', 'OLDPWD', 'SHELL', 'SHLVL', 'TERM', 'COLORTERM', '_',
  'LANG', 'LANGUAGE', 'USER', 'LOGNAME', 'HOSTNAME', 'HOSTTYPE', 'OSTYPE', 'MACHTYPE',
  'TMPDIR', 'TMP', 'TEMP', 'EDITOR', 'VISUAL', 'PAGER', 'DISPLAY', 'NODE_ENV', 'CI',
  'CLAUDE_PROJECT_DIR', 'CLAUDE_CODE_SESSION_ID', 'PLAYWRIGHT_BROWSERS_PATH',
  'GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_REF_NAME', 'GITHUB_SHA', 'GITHUB_WORKSPACE',
  'GITHUB_EVENT_NAME', 'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_JOB', 'GITHUB_ACTOR',
  'RUNNER_OS', 'RUNNER_ARCH', 'RUNNER_TEMP', 'RUNNER_TOOL_CACHE',
]);
const STRUCTURAL_ENV_PREFIXES = ['LC_', 'XDG_'];

// Below this, a value collides with ordinary prose too often to redact — and an
// under-8-char secret is beyond saving anyway.
const MIN_SECRET_LENGTH = 8;

// The redaction list: [{ name, form }], longest form first so a value that
// contains another value is consumed whole. Each value contributes its raw form
// and, when different, its JSON-escaped form — the shape it takes inside a raw
// JSONL line.
export function buildRedactionValues(env = process.env, extraValues = []) {
  const out = [];
  const seen = new Set();
  const add = (name, value) => {
    if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) return;
    for (const form of new Set([value, JSON.stringify(value).slice(1, -1)])) {
      if (form.length >= MIN_SECRET_LENGTH && !seen.has(form)) { seen.add(form); out.push({ name, form }); }
    }
  };
  for (const [name, value] of Object.entries(env)) {
    if (STRUCTURAL_ENV.has(name) || STRUCTURAL_ENV_PREFIXES.some((p) => name.startsWith(p))) continue;
    add(name, value);
  }
  for (const { name, value } of extraValues) add(name, value);
  return out.sort((a, b) => b.form.length - a.form.length);
}

// Values a known credential store holds, for the redaction list — same
// treatment as env values. Absent or unreadable stores contribute nothing.
export function credentialStoreValues(home = homedir()) {
  const values = [];
  try {
    const walk = (node) => {
      if (typeof node === 'string') values.push({ name: 'claude-credentials', value: node });
      else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(JSON.parse(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8')));
  } catch { /* no store — nothing to enumerate */ }
  return values;
}

// The backstop net, for secrets that never lived in this process's environment
// (a token pasted into chat, a key read from a file mid-session): high-confidence
// credential shapes only, so prose that merely mentions a prefix stays untouched.
// Boundary stated honestly: a secret the session itself transformed (base64,
// split across lines) is invisible to any static scrub — the branch shares the
// repo's own access control, and GitHub push protection remains the last net.
const SECRET_PATTERNS = [
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ['github-token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['api-key', /\bsk-[A-Za-z0-9]{32,}\b/g],
  ['aws-key-id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g],
];

export function scrub(text, redactions = []) {
  let out = text;
  for (const { name, form } of redactions) out = out.split(form).join(`[REDACTED:env:${name}]`);
  for (const [kind, re] of SECRET_PATTERNS) out = out.replace(re, `[REDACTED:${kind}]`);
  return out;
}

// `2026-07-19T0940Z--issue-123--<session>.jsonl` — minute-precision stamp first
// (a bare listing sorts and ages by name), then the issue the merge closed, then
// the session id (the delta lookup key).
export function logFilename(nowIso, issue, sessionId) {
  const stamp = `${nowIso.slice(0, 10)}T${nowIso.slice(11, 13)}${nowIso.slice(14, 16)}Z`;
  return `${stamp}--issue-${issue}--${sessionId}.jsonl`;
}

export function parseLogFilename(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})Z(?:-\d+)?--issue-(\d+)--(.+)\.jsonl$/.exec(name);
  if (!m) return null;
  return { capturedAt: `${m[1]}T${m[2]}:${m[3]}:00Z`, issue: Number(m[4]), sessionId: m[5] };
}

// --- git plumbing -------------------------------------------------------------

function git(root, args, { input, allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', input });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return r;
}

// commit-tree needs an identity; use the configured one, fall back to a fixed
// capture identity rather than failing in a bare automation environment.
function identityArgs(root) {
  const email = git(root, ['config', 'user.email'], { allowFail: true }).stdout.trim();
  return email ? [] : ['-c', 'user.name=claudinite-capture', '-c', 'user.email=capture@claudinite'];
}

// The remote branch tip's local object id, fetching its objects if it exists.
function fetchTip(root, branch) {
  const ls = git(root, ['ls-remote', '--heads', 'origin', branch]).stdout.trim();
  if (!ls) return null;
  git(root, ['fetch', '--quiet', 'origin', branch]);
  return git(root, ['rev-parse', 'FETCH_HEAD']).stdout.trim();
}

const BRANCH_README = `# conversation-logs

Captured working-session conversations (one JSONL per merge), pushed by the
grow_with_claudinite pack's capture step and consumed by its conversation-extract
daily task (a fleet run_daily unit). An orphan work-queue branch: never merged, files
deleted by the retention prune once extracted and aged out. See the pack README
(packs/grow_with_claudinite/README.md in the Claudinite canon) for the standard.
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Compute the delta against the fetched tip and push it as one new file. The
// whole read-build-push runs inside the retry loop so a lost push race (another
// session captured first) recomputes against the fresh tip instead of clobbering.
export async function capture({ root, branch, sessionId, bundled, issue, now, redactions = [] }) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const tip = fetchTip(root, branch);
    const treeLines = tip
      ? git(root, ['ls-tree', tip]).stdout.split('\n').filter(Boolean)
      : [];
    const names = treeLines.map((l) => l.split('\t')[1]);

    const prior = names.filter((n) => n.endsWith(`--${sessionId}.jsonl`));
    let lastTs = null;
    for (const name of prior) {
      const text = git(root, ['show', `${tip}:${name}`]).stdout;
      const max = maxTimestamp(bundleStreams([parseLines(text)]));
      if (max && (!lastTs || max > lastTs)) lastTs = max;
    }

    const delta = sliceAfter(bundled, lastTs);
    if (delta.length === 0) return { name: null, lastTs };

    let name = logFilename(now, issue, sessionId);
    for (let k = 2; names.includes(name); k += 1) name = logFilename(now, issue, sessionId).replace('Z--', `Z-${k}--`);
    const content = delta.map((l) => scrub(l.raw, redactions)).join('\n') + '\n';

    const blob = git(root, ['hash-object', '-w', '--stdin'], { input: content }).stdout.trim();
    const lines = [...treeLines, `100644 blob ${blob}\t${name}`];
    if (!tip && !names.includes('README.md')) {
      const readme = git(root, ['hash-object', '-w', '--stdin'], { input: BRANCH_README }).stdout.trim();
      lines.push(`100644 blob ${readme}\tREADME.md`);
    }
    const tree = git(root, ['mktree'], { input: lines.join('\n') + '\n' }).stdout.trim();
    const msg = `capture conversation log ${name} [skip ci]`;
    const commitArgs = [...identityArgs(root), 'commit-tree', tree, ...(tip ? ['-p', tip] : []), '-m', msg];
    const commit = git(root, commitArgs).stdout.trim();

    const push = git(root, ['push', '--quiet', 'origin', `${commit}:refs/heads/${branch}`], { allowFail: true });
    if (push.status === 0) return { name, lastTs, entries: delta.length };
    if (attempt < 3) await sleep(attempt * 2000); // lost a race or a network blip — refetch and rebuild
  }
  throw new Error(`could not push to ${branch} after 3 attempts`);
}

// --- transcript discovery -----------------------------------------------------

// Claude Code keeps session transcripts under <config>/projects/, one directory
// per project. CLAUDE_CONFIG_DIR relocates that config root when set (honor it so
// discovery follows the harness); otherwise it is ~/.claude.
function projectsRoot() {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

// The per-project directory slug: the launch cwd path with every non-alphanumeric
// character dashed. USUALLY equal to the git root path — but not guaranteed, which
// is why discovery below never trusts it alone.
function slugFor(root) {
  return root.replace(/[^A-Za-z0-9]/g, '-');
}

function newestTranscript(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  let best = null;
  for (const f of files) {
    const path = join(dir, f);
    const mtime = statSync(path).mtimeMs;
    if (!best || mtime > best.mtime) best = { path, mtime };
  }
  return best?.path ?? null;
}

// Locate this session's transcript. The session id names the file exactly
// (<sessionId>.jsonl), so search every project directory for it first — that
// survives the case the slug cannot: a remote/web session whose launch cwd (and
// thus transcript slug) differs from the git-root path this script derives, which
// otherwise points at a directory that never existed. Fall back to the slug
// directory's newest transcript, then to the newest transcript anywhere.
export function findTranscript({ root, sessionId, projects = projectsRoot() }) {
  const dirs = existsSync(projects)
    ? readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(projects, d.name))
    : [];
  if (sessionId) {
    for (const dir of dirs) {
      const hit = join(dir, `${sessionId}.jsonl`);
      if (existsSync(hit)) return hit;
    }
  }
  const bySlug = newestTranscript(join(projects, slugFor(root)));
  if (bySlug) return bySlug;
  let best = null;
  for (const dir of dirs) {
    const path = newestTranscript(dir);
    if (path) { const mtime = statSync(path).mtimeMs; if (!best || mtime > best.mtime) best = { path, mtime }; }
  }
  return best?.path ?? null;
}

// Subagent sidechains, when the harness writes them as separate files: any
// agent-*.jsonl under the session's own directory. (Current harnesses inline
// sidechain entries in the main file; this sweeps up the split-file layout too.)
function sidechainFiles(transcript, sessionId) {
  const roots = [join(dirname(transcript), sessionId)];
  const out = [];
  while (roots.length) {
    const dir = roots.pop();
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) roots.push(join(dir, d.name));
      else if (/^agent-.*\.jsonl$/.test(d.name)) out.push(join(dir, d.name));
    }
  }
  return out.sort();
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!/^[1-9]\d*$/.test(args.issue ?? '')) {
    console.error('required: --issue <n> — the issue number the merged PR closes (from its "Closes #<n>")');
    process.exit(2);
  }
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).stdout.trim();
  // The discovery key: the session id names the transcript file. Explicit
  // --session wins; otherwise the harness-set CLAUDE_CODE_SESSION_ID.
  const sessionId = args.session ?? process.env.CLAUDE_CODE_SESSION_ID;
  const transcript = args.transcript ?? findTranscript({ root, sessionId });
  if (!transcript || !existsSync(transcript)) {
    console.error(args.transcript
      ? `no session transcript found at ${args.transcript}`
      : `no session transcript found for session ${sessionId ?? '(unknown)'} under ${projectsRoot()}`);
    process.exit(1);
  }
  // The identity for delta-keying and naming comes from the file we actually
  // read (its basename IS its session id), so an explicit --transcript keeps its
  // own identity rather than inheriting the ambient env session.
  const resolvedSession = args.session ?? basename(transcript, '.jsonl');
  const streams = [
    parseLines(readFileSync(transcript, 'utf8')),
    ...sidechainFiles(transcript, resolvedSession).map((f) => parseLines(readFileSync(f, 'utf8'))),
  ];
  const bundled = bundleStreams(streams);
  if (bundled.length === 0) {
    console.error(`transcript ${transcript} holds no parseable entries`);
    process.exit(1);
  }

  const result = await capture({
    root,
    branch: args.branch ?? DEFAULT_BRANCH,
    sessionId: resolvedSession,
    bundled,
    issue: Number(args.issue),
    now: new Date().toISOString(),
    redactions: buildRedactionValues(process.env, credentialStoreValues()),
  });
  if (result.name === null) {
    console.log(`nothing new to capture — session ${resolvedSession} already captured through ${result.lastTs}`);
  } else {
    const delta = result.lastTs ? ` (delta since ${result.lastTs})` : '';
    console.log(`captured ${result.entries} entries${delta} → ${result.name} on ${args.branch ?? DEFAULT_BRANCH}`);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
