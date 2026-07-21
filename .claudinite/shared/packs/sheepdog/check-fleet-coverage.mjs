#!/usr/bin/env node
// The sheepdog pack's fleet-coverage CENSUS — the cross-repo reach the pack adds.
// Run by the sheepdog repo's coverage workflow (materialized from the pack's stub
// by baselining — workflow_dispatch only, no schedule of its own), which checks
// out Claudinite and runs this with the FLEET_GITHUB_TOKEN.
//
// Its concern is COVERAGE ALONE — one thing: reads the fleet config from the
// sheepdog (home) repo's sheepdog pack-entry config (owner to cover + exclude list),
// enumerates every repo under that owner, classifies each (covered / uncovered /
// excluded / skipped fork-or-archived), publishes the picture to the run summary,
// and converges one adoption issue per actionable uncovered repo in the home repo
// (open while uncovered, closed once covered or excluded). It does NOT build the
// work plan (that is the core planner's job, routines/fleet/plan.mjs) and it does
// NOT touch migrations: application and retirement are the migrations flow's own
// standalone passes (migrations/fleet-apply.mjs + migrations/fleet-retire.mjs, run
// by the daily routine) — the census is a coverage audit, not a migrations helper.
//
// Two rules kept deliberately:
//   - a marker check that ERRORS makes the repo UNKNOWN, never uncovered — no
//     issue is opened for it and the run fails so the error escalates;
//   - an unreadable/absent sheepdog config aborts the census — absence is
//     not consent to cover everything with no exclusions.
//
// Dependency-free (global fetch, Node 20+); read-only toward every repo except the
// home repo, where it writes the adoption issues + label.
// The cross-repo REST primitives are the census's own (fleet-api.mjs, co-located).

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeGh, paged, isCovered } from './fleet-api.mjs';

const LABEL = 'fleet-adoption';
const adoptionTitle = (fullName) => `Adopt ${fullName} into the Claudinite fleet`;
const TITLE_RE = /^Adopt (\S+\/\S+) into the Claudinite fleet$/;

function adoptionBody(fullName) {
  return [
    `\`${fullName}\` exists under this account but does not mount Claudinite (no tracked`,
    '`.claudinite/` signal on its default branch) and is not on the exclude list.',
    '',
    'Pick one:',
    '',
    '- **Adopt it** — grant the repo to the sheepdog environment\'s per-repo access list;',
    '  the next daily run then baselines (bootstraps) it automatically.',
    `- **Keep it out** — add \`${fullName}\` to the sheepdog pack entry's \`config.exclude\` in this`,
    '  (sheepdog) repo\'s `.claudinite-checks.json`, with a reason.',
    '',
    'This issue is converged by the daily Fleet Coverage census: it closes itself once the',
    'repo is covered (`completed`) or opted out (`not planned`), and a close without either',
    'gets reopened while the repo stays uncovered.',
  ].join('\n');
}

// --- fleet config (from the sheepdog repo's sheepdog pack entry) --------------

// The sheepdog repo's .claudinite-checks.json carries, on its sheepdog pack entry:
//   { "id": "sheepdog", "config": { owner: "missingbulb", kind: "user", exclude: ["owner/repo", ...] } }
// owner is who to cover (default: the sheepdog repo's own owner); exclude is the repos
// deliberately kept out (a full owner/name each, lowercased). This reads the home
// repo's file raw (fetched over the API, no engine on hand), so it resolves the
// entry itself — legacy top-level packConfig.sheepdog stays readable underneath
// until the `pack-entry-config` baseline migration retires (drop the fallback then).
// A missing config is an unreadable config: throw — absence is not consent to
// cover everything.
export function parseSheepdogConfig(cfg, home) {
  const entry = (Array.isArray(cfg?.packs) ? cfg.packs : []).find((e) => e?.id === 'sheepdog');
  const sd = entry?.config ?? cfg?.packConfig?.sheepdog;
  if (!sd || typeof sd !== 'object') {
    throw new Error(`the sheepdog repo ${home} declares no sheepdog config { owner, exclude } (on the pack entry or legacy packConfig.sheepdog) — nothing to cover`);
  }
  const owner = String(sd.owner ?? home.split('/')[0]).toLowerCase();
  const exclude = new Set((Array.isArray(sd.exclude) ? sd.exclude : []).map((s) => String(s).toLowerCase()));
  return { owner, exclude };
}

// --- adoption-issue convergence ----------------------------------------------

async function ensureLabel(gh, home) {
  const { status } = await gh(`/repos/${home}/labels`, {
    method: 'POST',
    body: { name: LABEL, color: '1D76DB', description: 'Repo awaiting adoption into the Claudinite fleet' },
  });
  if (status !== 201 && status !== 422) throw new Error(`creating label ${LABEL} returned ${status}`);
}

async function convergeIssues(gh, home, { uncovered, coveredSet, optedOutSet }) {
  const actions = [];
  const all = (await paged(gh, `/repos/${home}/issues?labels=${LABEL}&state=all`))
    .filter((i) => !i.pull_request);
  const open = new Map(all.filter((i) => i.state === 'open').map((i) => [i.title, i]));
  const closed = all.filter((i) => i.state === 'closed');

  for (const fullName of uncovered) {
    const title = adoptionTitle(fullName);
    if (open.has(title)) continue;
    const prior = closed.filter((i) => i.title === title)
      .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at))[0];
    if (prior && prior.state_reason === 'not_planned') continue; // owner declined; opt-out is the standing fix
    if (prior) {
      await gh(`/repos/${home}/issues/${prior.number}`, { method: 'PATCH', body: { state: 'open' } });
      await gh(`/repos/${home}/issues/${prior.number}/comments`, {
        method: 'POST', body: { body: `Reopened by the census: \`${fullName}\` is still uncovered.` },
      });
      actions.push(`reopened #${prior.number} (${fullName})`);
    } else {
      const { status, json } = await gh(`/repos/${home}/issues`, {
        method: 'POST',
        body: { title, body: adoptionBody(fullName), labels: [LABEL] },
      });
      if (status !== 201) throw new Error(`creating adoption issue for ${fullName} returned ${status}`);
      actions.push(`opened #${json.number} (${fullName})`);
    }
  }

  for (const [title, issue] of open) {
    const m = TITLE_RE.exec(title);
    if (!m) continue;
    const fullName = m[1].toLowerCase();
    let reason = null; let note = null;
    if (coveredSet.has(fullName)) {
      reason = 'completed'; note = 'now mounts Claudinite — covered';
    } else if (optedOutSet.has(fullName)) {
      reason = 'not_planned'; note = "on the exclude list (the sheepdog pack entry's config.exclude)";
    } else if (!uncovered.includes(fullName)) {
      reason = 'not_planned'; note = 'no longer an adoption candidate (deleted, archived, transferred, or now a fork)';
    }
    if (!reason) continue;
    await gh(`/repos/${home}/issues/${issue.number}/comments`, {
      method: 'POST', body: { body: `Closed by the census: \`${m[1]}\` ${note}.` },
    });
    await gh(`/repos/${home}/issues/${issue.number}`, {
      method: 'PATCH', body: { state: 'closed', state_reason: reason },
    });
    actions.push(`closed #${issue.number} (${m[1]}: ${note})`);
  }
  return actions;
}

// --- main --------------------------------------------------------------------

async function main() {
  const token = process.env.FLEET_GITHUB_TOKEN;
  const home = process.env.GITHUB_REPOSITORY;
  if (!token) {
    throw new Error('FLEET_GITHUB_TOKEN is not set. Add a repo secret with a fine-grained PAT '
      + '(this account, ALL repositories, Metadata read, Contents read + Issues read/write) — '
      + 'the default GITHUB_TOKEN sees only this repo and cannot take a fleet census.');
  }
  if (!home || !home.includes('/')) throw new Error('GITHUB_REPOSITORY is not set (owner/repo)');
  const gh = makeGh(token);

  // Read the fleet config from this (sheepdog) repo's sheepdog pack entry.
  const cfgRes = await gh(`/repos/${home}/contents/.claudinite-checks.json`);
  if (cfgRes.status !== 200 || !cfgRes.json?.content) {
    throw new Error(`the sheepdog repo ${home} has no readable .claudinite-checks.json (status ${cfgRes.status})`);
  }
  let cfg;
  try { cfg = JSON.parse(Buffer.from(cfgRes.json.content, 'base64').toString('utf8')); } catch (e) {
    throw new Error(`unparsable .claudinite-checks.json on ${home}: ${e.message}`);
  }
  const { owner, exclude: optOut } = parseSheepdogConfig(cfg, home);

  const mine = (await paged(gh, '/user/repos?affiliation=owner'))
    .filter((r) => r.owner.login.toLowerCase() === owner);
  if (mine.length === 0) {
    throw new Error(`enumeration returned no repos owned by ${owner} — wrong token user or scope; `
      + 'refusing to run a census that would close every adoption issue as stale');
  }

  const covered = []; const uncovered = []; const optedOut = []; const skipped = []; const unknown = [];
  for (const r of mine.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullName = r.full_name.toLowerCase();
    if (fullName === home.toLowerCase()) continue; // the canon doesn't mount itself
    if (r.archived || r.fork) { skipped.push(`${r.full_name} (${r.archived ? 'archived' : 'fork'})`); continue; }
    let isCov;
    try {
      isCov = await isCovered(gh, r.full_name);
    } catch (e) {
      unknown.push(`${r.full_name} — ${e.message}`);
      continue;
    }
    if (isCov) covered.push(fullName);
    else if (optOut.has(fullName)) optedOut.push(fullName);
    else uncovered.push(fullName);
  }

  await ensureLabel(gh, home);
  const actions = await convergeIssues(gh, home, {
    uncovered, coveredSet: new Set(covered), optedOutSet: new Set(optedOut),
  });

  const summary = [
    `# Fleet coverage census — ${owner}`,
    '',
    `| covered | uncovered | opted out | skipped (fork/archived) | unknown |`,
    `| --- | --- | --- | --- | --- |`,
    `| ${covered.length} | ${uncovered.length} | ${optedOut.length} | ${skipped.length} | ${unknown.length} |`,
    '',
    uncovered.length ? `**Uncovered (adoption issue open):** ${uncovered.join(', ')}` : '**Uncovered:** none 🎉',
    optedOut.length ? `**Opted out:** ${optedOut.join(', ')}` : '',
    skipped.length ? `**Skipped:** ${skipped.join(', ')}` : '',
    unknown.length ? `**UNKNOWN (marker check errored — fix the token/scope):** ${unknown.join('; ')}` : '',
    actions.length ? `**Issue actions:** ${actions.join('; ')}` : '**Issue actions:** none (converged)',
  ].filter(Boolean).join('\n');

  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);

  if (unknown.length) {
    throw new Error(`${unknown.length} repo(s) could not be classified — unknown is not uncovered, `
      + 'no adoption issues were opened for them, and this run fails so the cause is escalated');
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => { console.error(`fleet-coverage census failed: ${e.message}`); process.exit(1); });
}
