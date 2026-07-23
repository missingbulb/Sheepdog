// grow_with_claudinite task: growth-extract — the growth lifecycle's CAPTURE
// stage (per-project-scheduling DESIGN §6). Reviews the repo's recent activity and
// folds any durable, reusable lesson into the repo's own local packs, landing
// through a PR that auto-merges once the repo's checks pass. Worker: task.md.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'growth-extract',
  frequency: 'daily-1h',           // the 03:00 slot — lessons captured from an already-converged mount (DESIGN §2)
  signals: ['commits', 'prs', 'issues'],
  model: 'opus',                   // generalizing/curating lessons is the heaviest judgment, and auto-merge means no human reviews the PR
  outcome: 'merged-pr',            // additive edits to the repo's own local packs; arms auto-merge after CI
  worker: 'task.md',

  // Fire on a SUBSTANTIVE default-branch change (not any change): a bot bump /
  // [skip ci] / nightly-baselining commit advancing main is not a lesson to
  // extract — `commits.substantiveChange` already applies that classification.
  // Pass the substantive shas + touched PR/issue numbers as binding scope so the
  // worker reads exactly the window that triggered it.
  precondition(signals) {
    const commits = signals.commits ?? {};
    if (!commits.substantiveChange) {
      return { run: false, reason: 'no substantive default-branch change in the window' };
    }
    const shas = (commits.list ?? []).filter((c) => c.substantive).map((c) => c.sha.slice(0, 7));
    const prs = signals.prs?.touched ?? [];
    const issues = signals.issues?.touched ?? [];
    const context = [`Scope: the ${shas.length} substantive commit(s) in the window — ${shas.join(', ')}.`];
    if (prs.length) context.push(`PRs touched in the window: ${prs.map((n) => `#${n}`).join(', ')}.`);
    if (issues.length) context.push(`Issues touched in the window: ${issues.map((n) => `#${n}`).join(', ')}.`);
    return { run: true, reason: `${shas.length} substantive commit(s) in the window`, context };
  },
};
