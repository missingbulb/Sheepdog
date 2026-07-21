#!/usr/bin/env node
// Environment requirements — a pack declares a toolchain (or per-repo deps) a
// cloud session needs but the base image doesn't ship, via an optional `env`
// field on its pack.mjs. Driven by the repo's ACTIVE packs and the per-pack
// parameters it supplies in .claudinite-checks.json (each pack entry's
// `config`; loadConfig folds the legacy top-level "packConfig" into the same
// view):
//
//   node env.mjs install   Run every active pack's `setup` in the checkout. The
//                          project's one generic environment-setup script (in
//                          .claudinite/) calls this after syncing the corpus;
//                          installs land in the environment image (snapshotted,
//                          reused).
//   node env.mjs check     SessionStart assertion (web only): run every active
//                          pack's `probe`; if a requirement isn't actually
//                          present, inject the halt-gate context telling the
//                          assistant to have the user re-run the setup. A pure
//                          assertion on the real environment — no version flag;
//                          the probes ARE the source of truth.
//   node env.mjs plan      Print what install would run (review / debug).
//
// A pack's declaration — `setup` and `probe` may be a string, or a function of
// the project's per-pack params (so a repo can say WHERE its package.json is):
//   env: {
//     label: 'Node dependencies',
//     setup: (p) => (p.dirs ?? ['.']).map((d) => `( cd "${d}" && npm ci ) || true`).join('\n'),
//     probe: (p) => (p.dirs ?? ['.']).map((d) => `[ -d "${d}/node_modules" ]`).join(' && '),
//   }
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadPacks, isActive } from './registry.mjs';
import { loadConfig } from '../checks/lib/context.mjs';

const resolveField = (field, params) =>
  typeof field === 'function' ? field(params) : field;

/**
 * The env declarations of a repo's active packs, each resolved against the
 * project's per-pack params (each pack entry's `config` in
 * .claudinite-checks.json, via loadConfig's normalized packConfig view).
 */
export async function activeEnvs(projectRoot, { packs, config } = {}) {
  config ??= loadConfig(projectRoot);
  // Include the project's own local packs — a local pack may declare an `env`
  // toolchain requirement just like a canon pack.
  packs ??= await loadPacks({ localRoot: projectRoot });
  return packs
    .filter((p) => p.env && isActive(p, config))
    .map((p) => {
      const params = (config.packConfig && config.packConfig[p.id]) || {};
      return {
        id: p.id,
        label: p.env.label ?? p.id,
        setup: resolveField(p.env.setup, params),
        probe: resolveField(p.env.probe, params),
      };
    });
}

/** Pure decision: which active requirements aren't present. `probe(env) -> bool`. */
export function evaluate(envs, probe) {
  return envs.filter((e) => !probe(e)).map((e) => `${e.label} is not installed`);
}

const runBash = (script, cwd, opts = {}) =>
  spawnSync('bash', ['-c', script], { cwd, ...opts });

// --- install (runs once at environment-image build) ---------------------
async function install(projectRoot) {
  const envs = await activeEnvs(projectRoot);
  for (const e of envs) {
    process.stdout.write(`\n=== ${e.label} (pack: ${e.id}) ===\n`);
    // Fragments own their own softness (`|| true` on transient steps); a hard
    // failure is logged but does not abort the rest — `check`'s probe is the
    // real gate and catches a genuinely-absent tool at session start.
    const r = runBash(e.setup, projectRoot, { stdio: 'inherit' });
    if (r.status !== 0) {
      process.stderr.write(`Claudinite env: "${e.label}" setup exited ${r.status} (continuing).\n`);
    }
  }
  process.stdout.write(`\nClaudinite env: applied ${envs.length} requirement(s).\n`);
}

// --- check (SessionStart assertion — pure probes) -----------------------
function emitAlert(problems) {
  const msg =
    `Environment setup incomplete: ${problems.join('; ')}. Alert the user: re-paste the full body of ` +
    '.claudinite/mount/environment-setup.sh into the Claude Code Web environment Setup script field (environment ' +
    'settings), then start a fresh session so the snapshot rebuilds with the prerequisites installed.';
  // SessionStart adds stdout to the session context. Emit plain text (not a JSON
  // additionalContext envelope) so this step's output merges cleanly with the
  // other steps' prose when the session-start orchestrator forwards every step's
  // stdout through one hook — a hook's stdout that mixes JSON and prose parses as
  // neither.
  process.stdout.write(`${msg}\n`);
}

async function check(projectRoot) {
  // Web only — locally the developer installs toolchains directly.
  if (process.env.CLAUDE_CODE_REMOTE !== 'true') return;
  const envs = await activeEnvs(projectRoot);
  if (!envs.length) return;
  const problems = evaluate(
    envs,
    (e) => runBash(e.probe, projectRoot, { encoding: 'utf8' }).status === 0
  );
  if (problems.length) emitAlert(problems);
}

// --- plan (dry-run preview) ---------------------------------------------
async function plan(projectRoot) {
  const envs = await activeEnvs(projectRoot);
  for (const e of envs) {
    process.stdout.write(`# ${e.label} (pack: ${e.id})\n${e.setup}\n\n`);
  }
}

// CLI — but importable (the tests import the pure helpers above).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cmd = process.argv[2];
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (cmd === 'install') {
    await install(projectRoot);
  } else if (cmd === 'check') {
    await check(projectRoot); // fails soft — a SessionStart hook must never crash the session
  } else if (cmd === 'plan') {
    await plan(projectRoot);
  } else {
    process.stderr.write('usage: env.mjs <install|check|plan>\n');
    process.exit(2);
  }
}
