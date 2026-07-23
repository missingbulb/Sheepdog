#!/usr/bin/env node
// Work-scope conformance runner (see DESIGN.md): the rules that judge the
// current change — the branch's diff against the merge-base, and (at Stop) the
// session transcript — each declaring `scope: 'work'` and receiving the fluent
// work view (helpers/work.mjs). Repo-state rules and settings diagnostics run in
// check_the_world.mjs, which this file shares no code with (only the scope-blind
// mechanism helpers). The Stop hook runs this; CI runs the world runner.
//   --transcript PATH   the session transcript — conversation rules self-skip without it
//   --changed / --base REF / --root DIR   as in check_the_world.mjs
import { buildContext } from './helpers/repo-context.mjs';
import { discoverPacks } from '../pack_loader/pack-registry.mjs';
import { runActivePackRules } from './run-active-pack-rules.mjs';
import { reportFindings } from './report-findings.mjs';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const root = value('--root') || process.cwd();

const { packs } = await discoverPacks({ localRoot: root });
const ctx = buildContext({
  root,
  mode: has('--changed') ? 'changed' : 'all',
  baseOverride: value('--base'),
  transcriptPath: value('--transcript'),
});

const findings = runActivePackRules(ctx, packs, { includeRule: (rule) => rule.scope === 'work' });
const blocking = reportFindings(findings, ctx.config, { scopeLabel: 'work', mode: ctx.mode, baseRef: ctx.baseRef });
process.exit(blocking ? 1 : 0);
