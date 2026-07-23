#!/usr/bin/env node
// World-scope conformance runner (see DESIGN.md): the rules that audit repo
// state as it exists now, plus the pack-agnostic settings/load integrity
// diagnostics (malformed config, an unknown pack, a broken pack.mjs). Rules that
// judge the current change (`scope: 'work'`) run in check_the_work.mjs, which
// this file shares no code with — only the scope-blind mechanism helpers
// (run-active-pack-rules.mjs, report-findings.mjs). It names NO pack: adoption
// interview hygiene is a skill-owned check that rides its own pack's activation,
// and a malformed `questions` field is a load fault the pack registry reports.
// Wired into the project's test/CI flow, not the Stop hook. Dependency-free Node ≥18.
//   (default)   whole-repo sweep — milliseconds on a text corpus, sees cross-file breakage
//   --changed   transitional: scope to files changed vs the merge-base with main
//               (adopting a repo with a backlog only — not the enforcement default)
//   --base REF  override the base ref
//   --list      machine-readable catalog of every rule, both scopes (id, severity, description, doc)
//   --init      write .claudinite-checks.json — basics plus the fingerprinted packs
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildContext } from './helpers/repo-context.mjs';
import { discoverPacks, resolveDeclaredPacks } from '../pack_loader/pack-registry.mjs';
import { runActivePackRules, contributedRules } from './run-active-pack-rules.mjs';
import { reportFindings } from './report-findings.mjs';

const configError = (what, fix) => ({
  rule: 'config', severity: 'blocking', file: '.claudinite-checks.json', line: null,
  what, why: 'the settings file is what executes — a bad key, value, or pack name silently changes what runs', fix, doc: 'engine/checks/README.md',
});

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const root = value('--root') || process.cwd();

if (has('--list')) {
  const { packs } = await discoverPacks({ localRoot: root });
  const rules = [
    ...packs.flatMap((p) => p.rules ?? []),
    ...packs.flatMap((p) => p.skillChecks ?? []),
    ...packs.flatMap((p) => contributedRules(p, packs)),
  ];
  for (const r of rules.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`${r.id}\t${r.severity}\t${r.description}\t${r.doc}`);
  }
  process.exit(0);
}

if (has('--init')) {
  const path = join(root, '.claudinite-checks.json');
  if (existsSync(path)) {
    console.log(`${path} already exists — leaving it as-is.`);
    process.exit(0);
  }
  const { packs } = await discoverPacks({ localRoot: root });
  const ctx = buildContext({ root, mode: 'all' });
  const seeded = packs.filter((p) => p.seededByDefault && !p.local).map((p) => p.id);
  const detected = [...seeded, ...packs.filter((p) => p.detect && !p.local && p.detect(ctx)).map((p) => p.id)];
  const declared = resolveDeclaredPacks(detected, packs);
  writeFileSync(path, `${JSON.stringify({ packs: declared, maintenance: { delivery: 'auto-merge' } }, null, 2)}\n`);
  console.log(`Wrote ${path} (packs: ${declared.join(', ')}).`);
  process.exit(0);
}

const { packs, errors: packErrors } = await discoverPacks({ localRoot: root });
const ctx = buildContext({ root, mode: has('--changed') ? 'changed' : 'all', baseOverride: value('--base') });

const findings = [];
for (const e of ctx.config.errors) findings.push(configError(e.what, e.fix));
for (const e of packErrors) findings.push(configError(e.what, e.fix));
const knownIds = new Set(packs.map((p) => p.id));
for (const name of ctx.config.packs) {
  if (typeof name === 'string' && !knownIds.has(name)) {
    findings.push(configError(`declares unknown pack "${name}"`, `remove it or fix the name — declarable packs: ${[...knownIds].sort().join(', ')}`));
  }
}

findings.push(...runActivePackRules(ctx, packs, {
  includeRule: (rule) => rule.scope !== 'work',
  onContributeError: (pack, e) => findings.push(configError(
    `the "${pack.id}" pack's contributedRules failed: ${e.message}`, 'fix the pack manifest, or the contribution it interprets')),
}));

const blocking = reportFindings(findings, ctx.config, { scopeLabel: 'world', mode: ctx.mode, baseRef: ctx.baseRef });
process.exit(blocking ? 1 : 0);
