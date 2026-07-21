# repo-tidy worker

The repo's whole nightly tidy-up in one pass: **assess branches and PRs read-only, act on issues, then
reconcile the standing tracker** from what you found. The plan hands you `targets` — you don't
enumerate; work only the branches / PRs / issues it lists. Each per-object verdict comes from the
pack's single-object skill; this worker runs them across the targets and records the result.

## 1. Branches — assess only

For each branch in `targets.branches`, run the
[single-branch-status](../../../skills/single-branch-status/SKILL.md) skill for its verdict. (The
plan already drops the default branch and the orphan `conversation-logs` log stream, so
`targets.branches` never carries them — don't assess them.) **Never
delete, push, or merge.** Collect: one line each for the branches with **genuine unmerged work**
(`` `branch` — what it carries``); collapse the rest into one `Safe to delete: N — a, b, c` line; flag
any **orphaned** branch for a human. Recommend deletions; never perform them.

## 2. PRs — assess only

For each PR in `targets.prs`, run the [single-pr-status](../../../skills/single-pr-status/SKILL.md)
skill for its verdict. **Never close, merge, or comment on a PR.** Collect: one line each for the PRs
that should **stay open** (`#N — why it's live`); collapse the rest into one `Closeable: #a, #b —
merged/superseded/stale` line. Recommend closes; never close a PR.

## 3. Issues — the part that acts

For each issue in `targets.issues`, run the
[single-issue-triage](../../../skills/single-issue-triage/SKILL.md) skill. This is the one part that
**acts** — close / label / comment per the first applicable rule. The skill owns the action ladder and
the safeguards: "implemented in `main`" is verified against `main`'s current content and cited, never
inferred; when inconclusive it **comments, doesn't close**. Collect what each issue's triage did.

## 4. Reconcile — rewrite the standing tracker

From the verdicts above, reconcile this repo's tidy-up into its standing tracker. This runs last in the
pass, so the branch / PR / issue verdicts are already in hand.

One standing tracker issue per repo, titled exactly `Claudinite tracker: Repo Tidy` — found by that
**exact title, never a fuzzy match**; create it **already closed** if absent (never a fresh issue per
run, never a bare number that can dangle).

**One-time rename (drop once the fleet has converged):** if no issue carries the new title yet, look
for one titled exactly `Repo Tidy Tracker` (the old name) instead. If found, rename it to
`Claudinite tracker: Repo Tidy` and close it if it's open — do this once, then use the new title on
every later run. If neither title is found, create the new one (closed).

Touch it two ways each run:

- **Rewrite the issue body** to today's **dated** snapshot (newest-first): the PRs that should stay
  open, the branches carrying genuine unmerged work plus a safe-to-delete count, and the issue actions
  taken this run. The body is the live picture — it replaces yesterday's, it doesn't accumulate.
- **Add a dated comment** with today's status, so the body's snapshots leave a per-run trail.

Keep both short. **Never open, close, or reopen the tracker** — its state carries no meaning (the body
is the live picture; the state is just however it was created). Every run only rewrites the body and
appends a comment. The reconcile only *records* the branch/PR recommendations; it never acts on PRs or
branches.

`smarts: medium` — the superseded/orphaned branch and PR calls and the implemented-in-`main` issue call
are judgment; the reconcile itself is mechanical aggregation.
