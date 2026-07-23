# repo-tidy worker

The repo's whole nightly tidy-up in one pass: **assess branches and PRs read-only, act on issues, then
reconcile the standing tracker** from what you found. You run under the executor, dispatched by a
`ready-for-agent` issue; its **Context section is binding scope** — it lists the branches / PRs / issues to
work. Work only those; don't enumerate the repo yourself. **Never assess the repo's own default branch** (the
Context excludes the known infra branches, but the precondition cannot drop the default branch by name — that
is your responsibility here). Each per-object verdict comes from the pack's single-object skill; this worker
runs them across the targets and records the result. GitHub access is **MCP-only** (`mcp__github__*`).

The task's declared outcome ceiling is **`none`**: this task acts only on issues and never opens, closes,
comments on, merges, or pushes a PR — branch and PR handling is read-only recommendation.

## 1. Branches — assess only

For each branch in the Context's branch list, run the
[single-branch-status](../../skills/single-branch-status/SKILL.md) skill for its verdict. (Never assess the
default branch, the orphan `conversation-logs` log stream, or the `claudinite/maintenance` delivery branch.)
**Never delete, push, or merge.** Collect: one line each for the branches with **genuine unmerged work**
(`` `branch` — what it carries``); collapse the rest into one `Safe to delete: N — a, b, c` line; flag any
**orphaned** branch for a human. Recommend deletions; never perform them.

## 2. PRs — assess only

For each PR in the Context's PR list, run the [single-pr-status](../../skills/single-pr-status/SKILL.md) skill
for its verdict. **Never close, merge, or comment on a PR.** Collect: one line each for the PRs that should
**stay open** (`#N — why it's live`); collapse the rest into one `Closeable: #a, #b — merged/superseded/stale`
line. Recommend closes; never close a PR.

## 3. Issues — the part that acts

For each issue in the Context's issue list, run the
[single-issue-triage](../../skills/single-issue-triage/SKILL.md) skill. This is the one part that **acts** —
close / label / comment per the first applicable rule. The skill owns the action ladder and the safeguards:
"implemented in `main`" is verified against `main`'s current content and cited, never inferred; when
inconclusive it **comments, doesn't close**. Collect what each issue's triage did.

## 4. Reconcile — rewrite the standing tracker

From the verdicts above, reconcile this repo's tidy-up into its standing tracker. This runs last in the pass,
so the branch / PR / issue verdicts are already in hand.

One standing tracker issue per repo, titled exactly `Claudinite tracker: Repo Tidy` — found by that **exact
title, never a fuzzy match**; create it **already closed** if absent (never a fresh issue per run, never a bare
number that can dangle).

Touch it two ways each run:

- **Rewrite the issue body** to today's **dated** snapshot (newest-first): the PRs that should stay open, the
  branches carrying genuine unmerged work plus a safe-to-delete count, and the issue actions taken this run.
  The body is the live picture — it replaces yesterday's, it doesn't accumulate.
- **Add a dated comment** with today's status, so the body's snapshots leave a per-run trail.

Keep both short. **Never open, close, or reopen the tracker** — its state carries no meaning (the body is the
live picture; the state is just however it was created). Every run only rewrites the body and appends a
comment. The reconcile only *records* the branch/PR recommendations; it never acts on PRs or branches.

`model: sonnet` — the superseded/orphaned branch and PR calls and the implemented-in-`main` issue call are
judgment; the reconcile itself is mechanical aggregation.
