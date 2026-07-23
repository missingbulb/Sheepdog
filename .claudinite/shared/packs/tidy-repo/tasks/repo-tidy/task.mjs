// tidy-repo task: repo-tidy — the whole nightly tidy-up in one unit
// (per-project-scheduling DESIGN §6). One worker assesses this repo's branches
// and PRs read-only, acts on its issues, then reconciles the standing tracker
// from the verdicts. Worker: task.md. The old undeclared-canon carve-out dies —
// the canon repo declares tidy-repo like everyone else.
//
// Self-contained (imports nothing): the whole contract is this default export.

// Branches the tidy review must never assess. Beyond the default branch, the
// orphan `conversation-logs` branch is a grow_with_claudinite artifact (the
// captured-transcript stream, not project work) — it shares no history with main,
// so single-branch-status would flag it "orphaned" for a human on every widen. It
// is infrastructure the tidy sweep ignores altogether. Kept as a bare literal, not
// an import: the pack-independence barrier forbids tidy-repo from reaching into
// grow_with_claudinite, and the name is a fixed, well-known one. The stable
// maintenance branch is likewise never a tidy target — it is Claudinite's own
// standing delivery branch, not project work.
const IGNORED_BRANCHES = new Set(['conversation-logs', 'claudinite/maintenance']);

// A precondition has no repo handle, so it cannot look up the actual default
// branch name to drop it from the tidy candidate set — and the `branches` signal
// carries every open branch, the default included. Presuming the conventional
// default names here keeps a genuinely quiet repo (only its default branch open,
// no window activity) from firing tidy every night, which is the whole point of
// the gate. The worker (task.md) remains the authority that never assesses the
// repo's real default branch, so a repo whose default is unconventionally named
// is still safe — its default just also becomes a (cheap, read-only) tidy
// candidate here.
const PRESUMED_DEFAULT = new Set(['main', 'master']);

export default {
  id: 'repo-tidy',
  frequency: 'daily',              // the 04:00 slot (DESIGN §2)
  signals: ['prs', 'issues', 'branches', 'commits'],
  model: 'sonnet',                 // the landed-status and implemented-in-main calls are judgment; the reconcile is mechanical
  outcome: 'none',                 // assesses branches/PRs read-only and acts only on ISSUES — it never opens or merges a PR
  worker: 'task.md',

  // Run when the window surfaced genuine tidy work — a PR or issue actually
  // updated in the window — or on a SUBSTANTIVE default-branch move, which widens
  // the candidate set to ALL open branches/PRs/issues (a real commit can implement
  // an old issue or land an open PR without the object itself being touched). A
  // housekeeping-only main move (a nightly baseline commit, a bot bump) does not
  // widen — it lands nothing and implements nothing — so a quiet-but-maintained
  // repo isn't re-tidied every night.
  precondition(signals) {
    const substantive = signals.commits?.substantiveChange === true;

    // The branches collector surfaces names only, not the default-branch name, and
    // a precondition has no repo handle — so it cannot drop the default branch by
    // name here. It excludes the known infra branches (the ignore set above); the
    // worker (task.md) is the authority that never assesses the repo's own default
    // branch. The candidate set is the same whether or not the window was
    // substantive — an untouched branch is a cheap single-branch-status read that
    // collapses into the safe-to-delete line — so branches never gate on
    // substantiveChange, only PR/issue widening does.
    const branches = (signals.branches?.names ?? [])
      .filter((b) => !IGNORED_BRANCHES.has(b) && !PRESUMED_DEFAULT.has(b));

    // PRs/issues: widen to ALL open on a substantive move (a real commit can land
    // an open PR or implement an old issue without the object being touched);
    // otherwise only what the window actually touched.
    const openPrs = (signals.prs?.open ?? []).map((p) => p.number);
    const openIssues = (signals.issues?.open ?? []).map((i) => i.number);
    const touchedPrs = signals.prs?.touched ?? [];
    const touchedIssues = signals.issues?.touched ?? [];
    const prs = substantive ? openPrs : touchedPrs;
    const issues = substantive ? openIssues : touchedIssues;

    const active = substantive || touchedPrs.length || touchedIssues.length || branches.length;
    if (!active) return { run: false, reason: 'no touched PRs/issues, no non-default branches, no substantive move' };

    const reason = substantive
      ? 'project changed substantively — re-check landed status across all open objects'
      : 'repo activity in the window (touched PRs/issues or open branches)';
    const context = [];
    if (branches.length) context.push(`Branches to assess (read-only, recommend deletions only): ${branches.join(', ')}.`);
    if (prs.length) context.push(`PRs to assess (read-only): ${prs.map((n) => `#${n}`).join(', ')}.`);
    if (issues.length) context.push(`Issues to triage (the acting part): ${issues.map((n) => `#${n}`).join(', ')}.`);
    return { run: true, reason, context };
  },
};
