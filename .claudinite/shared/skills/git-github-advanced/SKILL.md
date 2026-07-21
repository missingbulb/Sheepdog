---
name: git-github-advanced
description: Git/GitHub procedures beyond the baseline lifecycle. Use for commit layering, recovering a branch after a squash-merge, CI-trigger rules, GitHub Actions gotchas, or merge-relocation traps.
---

# Portable git & GitHub procedures

The project-agnostic half of how we drive GitHub: the branch/commit-history rules for PR work, the CI-trigger rules, and how we keep merge-conflict churn cheap across parallel branches. (The issue → branch → PR task lifecycle that every task follows lives in [RULES.md](../../packs/basics/RULES.md), the `basics` baseline every project declares and every session loads — it's not task-gated, so it doesn't live here.) Project-specific GitHub procedures (the merge-to-main command, when to open a PR early, the merge-cheaply poll loop tuned to the local environment, and the generated-file merge rules) live in the consuming repo's own GitHub-procedures doc.

## Updating an issue's status: comment, don't overwrite

To post a **status update** on an issue (the lifecycle's "update the issue's status" step), use `add_issue_comment`. **Don't** reach for `issue_write` with `method: update` — that edits the issue itself and **replaces the whole body**, silently wiping the original description. Reserve `issue_write`/`update` for genuinely editing the issue (retitling, rewriting the body on purpose).

## Branch and commit history

### Commit often, in layers

While working a branch, commit frequently rather than landing one big commit at the end — small, ordered commits let the owner follow the work as it develops. Use commits to *layer* the work in the order you'd want it reviewed:

- Write the failing test(s) first, commit them, **then** implement the feature — so the history shows the contract before the code that satisfies it (and you've seen the test fail before trusting it, per [the engineering-practices skill](../engineering-practices/SKILL.md)).
- Keep any documentation update as its own commit *after* the feature, not folded into it.

There's no cost to a branch carrying many commits when the project uses a **squash** merge to `main` (one commit per PR): the squash collapses them into a single commit on `main`, so `main`'s one-commit-per-PR history is unaffected no matter how granularly the branch is committed.

- **One caveat, at merge time: before rebasing an *unmerged* multi-commit branch onto a *moved* base, collapse commits that rewrite the same lines into one.** When your own commits churn the same lines (build X → refactor → remove X, common in an iterative design session) and the base has advanced, rebasing the stack replays *every* intermediate conflict against the new base. The squash-merge discards those commits anyway, so collapse them first — `git reset --soft $(git merge-base HEAD origin/main)` then one fresh commit, and rebase that single commit: one conflict pass, not N. Lossless (unlike `reset --hard` + redo) and simpler than `--onto` when you want a single commit anyway.

- Don't rewrite published/shared history to satisfy a tooling or authorship check (e.g. a hook flagging "unverified" commits): only amend your own un-pushed branch commits. Commits already on a shared branch — including ones merged in from `main` — belong to that history; reset-authoring or rebasing them forks your branch away from it.
- After your commit is **squash-merged** to `main`, a *reused* feature branch still carries that original commit (the squash created a *new* commit on `main`, so the branch's own is unreachable from it) — and the next PR off the branch re-includes it in the diff, because the three-dot merge-base predates the squash. Sync the branch to `origin/main` before opening the next PR (`git rebase origin/main`, which drops the commit as an already-applied cherry-pick, or a hard reset): it's your own un-merged branch, so this is the amend-your-own-commits case above, not rewriting shared history.
  - **`git rebase origin/main` only drops the old commit cleanly when the branch carried a *single* squash-merged commit.** When it carried *several* commits that `main` squashed into *one* (then kept developing), git can't match them to the squash as already-applied, so it replays them and conflicts mid-rebase. Replant only the genuinely-new commits instead: `git rebase --onto origin/main <last-squash-merged-commit>` (then `git push --force-with-lease`). If the new work is small, a `git reset --hard origin/main` + redo beats fighting the replay.
  - **If the merge auto-deleted the remote branch, start follow-up work on a new branch off `origin/main`** rather than reusing the old name — it has no stale tracking ref and no rebase dance. If you do reuse the old name: `--force-with-lease` actively *fails* — `git push --force-with-lease` rejects with `stale info` then `couldn't find remote ref <branch>` because the lease expects a remote branch that no longer exists. There's nothing to overwrite, so `git fetch --prune` (drop the stale tracking ref) then a plain `git push -u origin <branch>` just recreates it.

## An automated commit-nag is not authorization to commit drift

An automated prompt to commit the working tree (a stop-hook, a CI nag) tells you the tree is dirty — not that the changes are yours or intended. Before obeying, inspect what actually changed (`git status` / `git diff`): if it's environment/setup drift — a submodule pointer moved by `git submodule update` at clone time, a lockfile a setup script regenerated, generated artifacts — revert it rather than committing it onto your branch. Committing drift slips an unintended dependency or generated-file bump into an unrelated change.

## Open a PR early when the reviewable artifact only exists on CI

The default is to hold a PR until asked. Reverse that when a change's only reviewable output is produced by CI — an e2e/heavy-browser run, or a rendered artifact (a UI-snapshot pixel diff, a generated gallery) that can't be exercised in the local sandbox. Opening the PR is how the change is seen working and how failures surface, so doing it up front — rather than iterating locally first, which proves nothing for these classes — is the faster path to a working, reviewable result. Each CI iteration costs a full round-trip, so get the first one running as early as possible.

## Sync early to keep merge conflicts small

Conflict size scales with how long a branch lives and how far it drifts from the default branch. Sync early rather than at the end: when starting work on a branch — and periodically while it's open — bring the latest default branch in first, so the branch carries current sources instead of discovering the gap at merge time. A one-commit-per-PR squash history already keeps each branch a single reviewable unit, so shorter-lived, freshly-synced branches are the norm.

**In a repo that forbids merge commits on the branch — the `squash-merge-history` check, or squash-only merging generally — sync by *rebasing*, never `git merge` the base in.** A `git merge origin/main` (even just to resolve conflicts) leaves a **merge commit** the check blocks, forcing a redo; `git pull --rebase` / `git rebase origin/main` replays your work with no merge commit. GitHub's **"Update branch"** button — and the `update_pull_request_branch` API behind it — is this same base-merge in disguise: it adds exactly the merge commit the check blocks, so refresh with a local rebase + `git push --force-with-lease` instead. The merge-conflict-resolution gotchas below apply to a rebase's conflicts exactly the same way.

## After a remote-side merge, fetch before branching off origin/main

A GitHub API/UI (or any remote-side) merge does **not** advance your local `origin/main` — it stays at the pre-merge commit until you `git fetch`. Branching off `origin/main` immediately after a remote merge forks the pre-merge state, silently missing the just-merged work; symptoms surface later as a missing file or a failed `git mv` on the new branch. Fix: `git fetch origin main` before creating the branch.

## `git pull` failing "refusing to merge unrelated histories" usually means upstream re-rooted

When syncing a long-lived local clone's default branch fails with `refusing to merge unrelated histories` (often alongside `ahead N, behind M`), the usual cause is that upstream **re-rooted** the branch — a history rewrite replaced the root commit — not repository corruption. Do **not** reach for `--allow-unrelated-histories`: that "fix" welds the two histories together into a merge nobody wants. Instead inspect what the local side uniquely holds (`git log origin/<branch>..<branch>` — typically just the old root), keep anything real by rebasing it onto the new history, then `git reset --hard origin/<branch>`. A work branch created from *fetched* refs is unaffected; only stale local refs from before the rewrite hit this.

## A conformance finding on history you didn't write may be a stale diff base — refresh before fixing

A Stop-hook or CI conformance check diffs your branch against `origin/main`. In a fresh cloud sandbox that ref can be **stale** — behind real `main` by whole merged PRs — so the check reads the wrong base and can flag findings on commits or code you never touched. Before acting on a finding you don't recognize, `git fetch origin <default-branch>` and re-run: a stale-base phantom disappears, and whatever survives against the current base is real — fix that. (The same stale ref bases new work on outdated product code, so fetch before building against `main`, too.)

The same reflex applies when a **real** (not phantom) red check blocks *your* PR and you've correctly pinned it as pre-existing and unrelated to your diff: that "not mine" diagnosis is a **sync-the-base** signal, not a fix-it-yourself-or-ask-the-user one — `main` has often *already fixed* it since you branched, so merge/rebase the latest base into your branch and re-check before proposing a fix or escalating.

## In a squash-merge repo, "commits ahead of main" does not mean "unmerged"

A squash-merge creates a new commit on `main` that the branch's own commits are unreachable from, so a branch whose work has already landed still shows ahead by N. **"Ahead by N" never alone means unmerged.** Determine real status by content, not raw count:

1. **PR state** — a merged PR means the work is in `main`; safe to delete however many commits show ahead.
2. **Content diff** — `git diff --stat main..branch`: if everything the branch adds is already in `main`, the work landed (catches a squash with no surviving PR).
3. **Superseded elsewhere** — the branch's work may have landed in `main` under a *different path or form* (a doc distilled into another, a feature re-implemented), so a file/line diff still shows its additions as branch-side and it reads as unmerged. Before concluding so, check whether its *intent* already exists in `main` — grep for the concept, not just the exact path.
4. **No merge-base** — `git merge-base` fails when a force-push rewrote `main` and orphaned the branch; can't be proven in or out mechanically; needs human review, never an automatic delete.
5. Otherwise — genuine unmerged work.

## A push or PR made with the Actions `GITHUB_TOKEN` does not start another workflow

GitHub suppresses workflow runs triggered by the built-in `GITHUB_TOKEN` to prevent recursion, so a workflow's own `git push` or `gh pr create` won't fire another workflow (e.g. a `test` or cache-refresh workflow). The one exception is `workflow_dispatch` / `repository_dispatch` — which is why an automation pipeline that needs the downstream checks to run must dispatch them explicitly. A run dispatched against a branch executes on its head commit, so its checks still attach to the PR. The same suppression covers a Claude session's own app-scoped pushes: creating a PR through the API does fire its `pull_request` run, but a follow-up push to that PR gets **no** `synchronize` run — so don't wait for checks that will never start on the new head; gate by running the CI commands locally, and rely on the post-merge run (merging through the merge API does fire the `push` workflow on the default branch).

## A workflow definition only takes effect once it's on the default branch

A `workflow_dispatch` or scheduled workflow runs from the copy on the **default branch**, and a `pull_request` run uses the workflow files from the PR's **base** branch — so a workflow you only added on a feature branch isn't dispatchable, and a build/CI change doesn't apply, until it's merged. Merge workflow and build-script changes *before* the release or run that depends on them, or that run executes the *old* definition (shipping a stale build, or silently skipping a check you thought you'd added). This is distinct from the `GITHUB_TOKEN` recursion rule above: even a human-triggered run reads the definition from the default/base branch, not your feature branch.

## A CI OIDC `sub` claim is matched case-sensitively by the cloud trust policy

GitHub's OIDC `sub` uses the repository's **canonical casing** (`repo:Owner/Repo:ref:…`), and a cloud trust policy compares it exactly — AWS IAM `StringEquals` is case-sensitive — so a trust policy written with the wrong case fails with a bare `Not authorized to perform sts:AssumeRoleWithWebIdentity` and **no** hint that casing is the cause. Match the exact canonical `owner/repo` (or list both casings in the condition). The same exact-match caution applies to any OIDC-federated cloud, not just AWS.

## Gate an optional CI job on a repo variable, not a secret

`secrets.*` are not available in a job-level `if:`, so a job gated on a secret can't evaluate its condition and **fails (red)** instead of skipping. Put a non-sensitive flag (a deploy-role ARN, a feature toggle) in a repository **variable** and gate with `if: ${{ vars.X != '' }}` so the job is **skipped (neutral)** until it's configured — keeping the default branch green for anyone who hasn't set the integration up. Reserve secrets for the values consumed *inside* the job's steps.

## An automated job needs a unique branch per run

An automated or scheduled job that derives its branch name from a non-unique key (e.g. the date) collides with itself on a repeat run for that key — `git checkout -b` fails when the branch already exists, and a push to the diverged remote branch is rejected non-fast-forward (so the run can't even open its PR). Give every run its own branch: append a per-run-unique suffix (`$RANDOM` / a short token) to the readable prefix.

## A workflow that adds a brand-new label must create it first

`gh issue edit --add-label "<name>"` fails when the label doesn't exist yet — unlike applying an already-defined label, GitHub won't create it on demand, so a workflow that introduces a new label breaks the first time it runs. Create it idempotently before the edit (`gh label create "<name>" --color … 2>/dev/null || true`), then `--add-label`.

## A GitHub Actions `run:` step's default shell has no `pipefail`

GitHub's implicit default run-shell is `bash -e {0}` — **without** `pipefail` — so a step piping through another command (e.g. `cmd 2>&1 | tee log`) reports the *last* command's exit code, not the piped command's: a failing command still shows the step green. Set `defaults.run.shell: bash` (job- or step-level), which GitHub runs as `bash --noprofile --norc -eo pipefail {0}`, so the step fails when any command in the pipe fails.

## An unattended workflow must escalate its own failure to a human-visible state

A workflow with no human watching the run — scheduled, triggered by a push/merge, or a fire-and-forget manual dispatch, with no other path that reaches a person — must converge a failure to something a human will see (e.g. open a `workflow-failure` issue for it) rather than merely exiting red in the Actions list, where nobody looks. Skip this only when the failure is already loud: a `pull_request`/push CI run that blocks merge with a red required check the author is watching, or a workflow that already flags the triggering issue itself on failure. The canon's [report-failure](../../.github/actions/report-failure/action.yml) action does exactly this — a **fresh** issue per failure, with earlier open failure issues for the same workflow closed as duplicates of the newest — so the current failure is always the single open bug to triage; a standing per-workflow issue appended to on each failure is an equally valid shape, the invariant is only that the red run reaches a person.

When the escalation is itself a separate reusable workflow invoked via `workflow_call`, permissions don't propagate implicitly through the chain: the job that calls it needs the permission explicitly granted (e.g. `issues: write`), and if that reusable workflow in turn calls another one, the middle workflow must forward the same grant to its own call — a caller two levels up granting it once is not enough.

## A CI job that reads submodule files must fetch submodules in its checkout

`actions/checkout` does **not** fetch submodules by default — the submodule directory is an empty folder in CI unless you pass `submodules: true` (or `recurse-submodules: true`). Without it, any gate that reads submodule content passes vacuously: the check is a no-op, not a signal. Add the flag to every CI job whose tests read submodule content.

## A CI job that inspects commit shape must check out the PR head, not the merge ref

On `pull_request`, `actions/checkout` checks out the synthetic `refs/pull/N/merge` commit by default — an ephemeral merge of the PR head into the base — so `HEAD` is itself a merge commit, not the branch tip. Any job that reasons about commit *shape* or history (merge commits, commit count, `--first-parent`, commit messages) reads that synthetic merge and misfires: a "no merge commits" check false-positives even on a linear branch, since `HEAD` is a merge. Check out the head SHA (`ref: ${{ github.event.pull_request.head.sha || github.sha }}`) so CI evaluates the same branch tip a local run does.

## To read a PR's CI result, look at its check runs — `get_status` misses Actions

GitHub **Actions** reports results as **check runs**, not the legacy **commit statuses**, so `pull_request_read` `method: get_status` returns `state: pending`, `total_count: 0` for a PR whose Actions CI has already **passed** — reading falsely as "no CI / not started," which can skip a real gate or trigger an endless wait. Gate on CI by reading the **check runs for the PR head SHA** (`get_check_run`, or the workflow run for that SHA) instead. Target the head SHA directly rather than `actions_list`-ing the repo's runs — that returns every run, its output is huge, and a specific check-run/SHA query is both correct and cheap.

## To confirm a non-PR run (push / dispatch), read its job logs — it has no PR check runs

A `push` or `workflow_dispatch` run isn't attached to a PR, so the PR-scoped check-run query above doesn't apply to it. Confirm such a run through the GitHub API/MCP tools: `get_job_logs(run_id, failed_only: true)` — "0 failed jobs" means green — or, for a release build, `get_release_by_tag`. Don't `curl` the run's status instead: in a sandboxed session `api.github.com` is proxy-blocked and returns an error body that never matches a success pattern, so a `curl`/`Monitor` poll silently reports "still running" until it times out.

## Mark large committed fixtures `linguist-vendored` to fix language stats

Large committed fixture files (full-page HTML, generated data dumps) can dwarf actual source by byte count and cause GitHub to mislabel the repo's primary language. Add a `.gitattributes` entry for each such path (e.g. `test/fixtures/*.html linguist-vendored`) to tell Linguist to ignore it; apply the same annotation whenever you add another large generated or fixture file.

## Renaming a directory that houses a submodule

`git mv` on a directory containing a submodule rewrites `.gitmodules` and the index correctly but leaves `.git/config` stale — its old `[submodule "<old/path>"]` entry lingers, so any operation that consults `.git/config` (submodule status, checkout) sees the old path until you fix it. Run `git submodule sync && git submodule update --init` after the move to propagate the new path and re-register the submodule.

## GitHub Markdown inside a `<td>` requires surrounding blank lines

In a GitHub-rendered Markdown file, cmark-gfm re-enters Markdown mode inside a raw `<td>` only when blank lines surround the cell's content — without them the cell is treated as a raw HTML block and its content is shown verbatim (no `![img]()`, no `**bold**`, no links). GitHub's sanitizer strips `style` / CSS, so a flexbox two-column layout won't render; use a plain `<table>` with `align` / `valign` / `width` instead. GFM pipe-table cells can't hold multi-line prose — use the raw-`<table>` form when a cell needs it. A leading inline `<!-- … -->` comment also opens an HTML block, so keep any such marker as the *last* token on the line, leaving the line to *start* as Markdown.

## `commit.gpgsign = true` does not cover merge commits

`commit.gpgsign = true` signs ordinary commits but does not apply to `git merge` — each merge produces an unsigned commit even with signing fully configured. In a repo that enforces commit verification, this requires a fix-up after the fact. Cover merges proactively: either pass `-S` to every `git merge` call, or set `merge.gpgsign = true` globally so merges are signed the same way commits are.

## When access is scoped to an explicit repo list, query per-repo — never an org/user-wide search

A broad call (e.g. `search_repositories` with `org:X`, or any list/search tool that takes no repo argument) returns every repo the token can see, not just an allowed subset — filtering the result afterward doesn't undo the fact that disallowed repos' data was already pulled into the call. When operating under a repo allowlist, scope every call explicitly instead: pass the specific `owner`/`repo` params, or anchor the query to `repo:owner/name`, one call per repo in the allowlist rather than one broad call filtered after the fact.

## Merging gotchas

These conflict/merge traps are independent of any one project's file layout.

### Merging across a file relocation

git's rename detection re-applies your content edits onto the moved files, but it does *not* fix *references* to the moved paths — an npm script, a `.gitattributes` glob, or a doc link naming the old location keeps pointing there and breaks with no conflict (a green local test on the old layout won't catch it either). After such a merge, grep the files your branch touched for the old paths.

### Merging in content that predates a branch-wide invariant

When your branch establishes a cross-cutting invariant — a renamed term, a "mentioned only in X" containment rule — a branch you merge in that *predates* it can silently reintroduce violations: its independent additions (a new file, a new section) auto-merge clean, no conflict, while still using the old form. Resolving the marked conflicts isn't enough. Re-run the check that *defines* the invariant (the grep) over the whole tree after the merge, not just the conflicted files.

### Porting old work forward across a changed invariant

The converse direction: when you re-implement or cherry-pick an *older* change onto current `main`, check each part against the invariants `main` has added since — not just whether it still applies. A part that violates a now-enforced guarantee becomes a **silent no-op** if taken verbatim (e.g. a guard that reverts any write outside an allowed set leaves the patch landed but doing nothing), so drop or redesign it rather than copy it.
