#!/usr/bin/env node
// Claudinite conformance-check runner (see DESIGN.md). Dependency-free Node ≥18.
//   (default)   whole-repo sweep — milliseconds on a text corpus, sees cross-file breakage
//   --changed   transitional: scope to files changed vs the merge-base with main
//               (adopting a repo with a backlog only — not the enforcement default)
//   --base REF  override the base ref
//   --list      machine-readable rule catalog (id, severity, description, doc)
//   --init      write .claudinite-checks.json — basics plus the fingerprinted packs
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildContext, loadConfig } from './lib/context.mjs';
import { applyConfig, render } from './lib/findings.mjs';
import { discoverPacks, isActive, resolveDeclaredPacks } from '../packs/registry.mjs';
import { interviewState } from '../packs/interview.mjs';
import { loadSkillRules } from '../skills/registry.mjs';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const root = value('--root') || process.cwd();

// Canon packs plus the repo's own local packs (.claudinite/local_packs/). A
// broken/duplicate manifest doesn't sink the run — it comes back in `packErrors`
// and is surfaced as a blocking config finding, so the Stop hook shows a
// diagnostic instead of silently dropping the pack's checks.
const { packs, errors: packErrors } = await discoverPacks({ localRoot: root });
// Skills own the test-the-world checks that validate their action (co-located
// with the SKILL.md), discovered alongside the packs and always run. A local
// pack's bundled skill checks ride its `skillChecks`, run only when the pack is
// active (below).
const skillRules = await loadSkillRules();

// A pack's contributedRules seam: the pack interprets the contributions other
// packs address to it on their manifests (`contributes`), returning
// first-class rules — how packs compose through declaration + configuration
// instead of importing each other's code. Isolated per pack, like manifest
// loading: one broken seam (a consumer-authored local pack's, say) must not
// sink the run.
const contributedRules = (pack, fromPacks, onError) => {
  try { return pack.contributedRules?.(fromPacks) ?? []; }
  catch (e) { onError?.(e); return []; }
};

if (has('--list')) {
  const rules = [
    ...packs.flatMap((p) => p.rules ?? []),
    ...packs.flatMap((p) => p.skillChecks ?? []),
    ...packs.flatMap((p) => contributedRules(p, packs)),
    ...skillRules,
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
  const ctx = buildContext({ root, mode: 'all' });
  // No pack is active by default, so the baseline is seeded as an explicit
  // declaration alongside the fingerprinted packs: every pack that flags
  // `seededByDefault` is written in (discovered structurally — the engine names
  // no pack), plus the ones a fingerprint detects. A seeded pack is still
  // opt-out-able where its own policy allows (baselining re-adds only the packs
  // whose absence it treats as drift), so removing a seeded declaration can
  // stick; each seeded pack ships its own one-time seed migration for the fleet.
  // Local packs are declared by hand, never fingerprinted or seeded — exclude
  // them from --init's seeding so a repo that already carries local packs (but
  // no config yet) doesn't auto-declare them.
  const seeded = packs.filter((p) => p.seededByDefault && !p.local).map((p) => p.id);
  const detected = [...seeded, ...packs.filter((p) => p.detect && !p.local && p.detect(ctx)).map((p) => p.id)];
  // A pack can't be imported without its dependencies — pull each declared pack's
  // `requires` closure into the declaration so it's complete and visible.
  const declared = resolveDeclaredPacks(detected, packs);
  // maintenance.delivery is deliberately materialized, not defaulted — the selection
  // must be visible in the file where a project would change it (see checks/README.md).
  writeFileSync(path, `${JSON.stringify({ packs: declared, rules: {}, accept: [], maintenance: { delivery: 'auto' } }, null, 2)}\n`);
  console.log(`Wrote ${path} (packs: ${declared.join(', ')}).`);
  // Adoption interviews, strict at bootstrap: the flow that runs --init has the
  // owner present, so surface every declared pack's questions for the adoption
  // interview NOW (bootstrap.md Part 6). Outside bootstrap the same gap only
  // ever surfaces as a mild SessionStart note (packs/interview.mjs).
  const { pending } = interviewState(packs, loadConfig(root));
  if (pending.length) {
    console.log('\nAdoption questions pending — interview the owner as part of this adoption: ask each'
      + ' question, record the answer verbatim on the pack\'s entry as answers.<question-id>, and'
      + ' derive the entry\'s config where the question\'s distill note says how.');
    for (const p of pending) for (const q of p.questions) console.log(`  ${p.packId} / ${q.id}: ${q.prompt}`);
  }
  process.exit(0);
}

const mode = has('--changed') ? 'changed' : 'all';
// --transcript: the session transcript the Stop hook forwards, enabling the
// conversation-surface rules; absent everywhere else (CI), where they self-skip.
const ctx = buildContext({ root, mode, baseOverride: value('--base'), transcriptPath: value('--transcript') });
ctx.knownPacks = packs; // for skill-ownership's corpus-integrity check

const configError = (what, fix) => ({
  rule: 'config', severity: 'blocking', file: '.claudinite-checks.json', line: null,
  what, why: 'the settings file is what executes — a bad key, value, or pack name silently changes what runs', fix, doc: 'checks/README.md',
});

let findings = [];
// Settings validity, checked at load: malformed JSON, an unknown property, and a
// wrong pack name are all equally settings errors. loadConfig reports the first
// two; the runner adds unknown pack names here because only it holds the registry.
for (const e of ctx.config.errors) findings.push(configError(e.what, e.fix));
// A broken/duplicate local pack.mjs is a config-level fault too — surface it with
// a diagnostic instead of silently omitting the pack (and its checks).
for (const e of packErrors) findings.push(configError(e.what, e.fix));
// knownIds spans canon AND local packs, so a declared local pack id is valid and
// the unknown-pack message lists it among the declarable packs. ctx.config.packs
// is loadConfig's normalized view — bare ids, a namespaced local_packs/<name>
// declaration already resolved through packEntryId — so the membership test here
// compares bare id to bare id whichever form the file used.
const knownIds = new Set(packs.map((p) => p.id));
for (const name of ctx.config.packs) {
  if (typeof name === 'string' && !knownIds.has(name)) {
    findings.push(configError(`declares unknown pack "${name}"`, `remove it or fix the name — declarable packs: ${[...knownIds].sort().join(', ')}`));
  }
}
// Adoption-interview hygiene (packs/interview.mjs). PENDING questions are
// deliberately not findings at all — they surface only as a mild SessionStart
// note, so an unattended nightly run is never blocked on a question nobody is
// present to answer. A STALE answer (its question no longer declared — renamed
// or removed upstream) is ADVISORY: visible, never run-failing, so a canon-side
// question change can't fail the fleet's CI overnight. A malformed `questions`
// declaration is a real manifest fault, blocking like any other.
const { stale, errors: questionErrors } = interviewState(packs, ctx.config);
for (const e of questionErrors) findings.push(configError(e.what, e.fix));
for (const s of stale) {
  findings.push({
    rule: 'config', severity: 'advisory', file: '.claudinite-checks.json', line: null,
    what: `the "${s.packId}" pack entry stores an answer for "${s.answerId}", a question the pack no longer declares`,
    why: 'a stale answer silently stops matching its question, so the stored intent goes unread and the interview re-asks',
    fix: 'remove the stale answer, or re-key it to the renamed question id',
    doc: 'packs/README.md',
  });
}
const activePacks = packs.filter((p) => isActive(p, ctx.config));
for (const pack of activePacks) {
  // A pack's conformance checks, a local pack's bundled skill-owned checks
  // (canon skill checks run ungated below; a local pack's ride its own
  // activation), and the rules this pack builds from other ACTIVE packs'
  // contributions (its contributedRules seam) — an undeclared pack neither
  // runs nor contributes.
  const contributed = contributedRules(pack, activePacks, (e) =>
    findings.push(configError(`the "${pack.id}" pack's contributedRules failed: ${e.message}`, 'fix the pack manifest, or the contribution it interprets')));
  for (const rule of [...(pack.rules ?? []), ...(pack.skillChecks ?? []), ...contributed]) {
    if (ctx.config.rules[rule.id] === 'off') continue;
    findings.push(...rule.run(ctx));
  }
}
// Skill checks always run — never gated on a pack being active.
for (const rule of skillRules) {
  if (ctx.config.rules[rule.id] === 'off') continue;
  findings.push(...rule.run(ctx));
}
findings = applyConfig(findings, ctx.config);
findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1));

for (const f of findings) console.log(`${render(f)}\n`);
const blocking = findings.filter((f) => f.severity === 'blocking').length;
const advisory = findings.length - blocking;
if (findings.length) {
  console.log(`${blocking} blocking, ${advisory} advisory (scope: ${mode}${ctx.baseRef ? ` vs ${ctx.baseRef}` : ''}).`);
}
process.exit(blocking ? 1 : 0);
