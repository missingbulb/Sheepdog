# Growth — extract lessons (per repo)

The growth lifecycle's capture stage: review this repo's recent activity and fold any durable, reusable lesson into the repo's own **local packs** (`.claudinite/local/packs/` — the normalized capture surface) — at the repo's own level, without straining to generalize it. It lands its edits through a PR that **auto-merges once the repo's checks pass** (no human review — the PR is armed for auto-merge, so daily capture never piles up as review requests); finding nothing to add on a given run is a perfectly good outcome.

You run under the executor, dispatched by a `ready-for-agent` issue whose **Context section is binding scope**: it names the substantive commit shas and the PRs/issues touched in the window — that is the activity to mine; do not widen it.

> This is the **unattended daily** capture. It writes only the repo's *own* local packs, so — **unlike** an owner-requested, in-session retrospective (which delivers a PR for a human to review) — it opens a PR and **arms auto-merge**: GitHub lands it once the repo's checks pass, with no review queue for daily lesson-capture to pile up in. The shared canon stays human-gated — lifting anything up into it is the central promote task's job (canon-side), and that PR waits for the owner.

## Capture at the repo's own level

Write each lesson at whatever level reads naturally for this repo — refer to its files, services, or mechanics wherever that's what makes the lesson clear, but don't force either extreme: don't contort a lesson to be hyper-specific, and don't polish it into a general, portable rule. Making a lesson portable is the central promote task's job, done canon-side later (it picks up whatever is merged here by its next run); here, just capture it usefully and let promotion lift whatever turns out to travel.

## Conventions used in this doc

- **Default branch.** `main` stands for **this repository's default branch** — substitute whatever the repo uses.
- **GitHub access is MCP-native.** Reading issue/PR activity and updating the tracking issue go through the session's **GitHub MCP tools** (`mcp__github__*`). The unattended run has no shell GitHub access — the shell reaches only a git-over-HTTPS proxy scoped to one repo, with no REST credential — so never reach for `gh`/`curl` or a cross-repo clone.
- **The repo's local packs.** The set identified in [this pack's README](../../README.md#identifying-a-projects-capture-surface-its-local-packs) — everything under `.claudinite/local/packs/` (the legacy `.claudinite/local_packs/` accepted during the rename window), the repo's own packs; never the read-only mounted canon elsewhere under `.claudinite/`.

## How it finds lessons (scoped to the window in Context)

1. **Read the window.** The window's **commits** (the shas named in Context — full bodies, diffs where a fix is non-obvious) and the **issue/PR activity** it names (the changed comments on those numbers).
2. **Extract only durable, reusable lessons** — gotchas, engineering practices, test discipline, architecture rules, project mechanics — and **dedupe** each against what the repo already documents. When in doubt, leave it out.
3. **Route each lesson to the owning local pack, and prefer the strongest mechanism.** Pick the pack whose territory the lesson belongs to (most repos have one general pack; some segregate a domain pack), then run the **local promotion ladder**: a deterministic rule becomes a **check** in that pack's `rules` (author the `.mjs`, list it on `pack.mjs`, add a red-first fixture — its failure message *is* the lesson), an activity-scoped procedure becomes a **pack skill**, and only what neither can carry lands as terse **prose** in the pack's `RULES.md`. A gotcha tied to one call site still goes as a comment right at that site (the file-local rule — [extracting-lessons.md](../../extracting-lessons.md) owns the usage-site-vs-central call). Write more checks and less prose; keep each addition terse and in the repo's own voice.

If an edit touches something a test reads (a doc constant, a code path), run the repo's offline test suite and keep it green before opening the PR.

## Output: a PR that auto-merges after CI

If it found at least one genuinely new lesson, it lands the edits **through a single auto-merging PR** — one commit for the whole run on a per-run-unique branch, not one per lesson. Open the PR (title `Claudinite growth: extract lessons`, its commit referencing the tracking issue so the `task-lifecycle` gate passes) and **arm auto-merge**: GitHub squash-merges it once the repo's checks pass — no human review, so daily lesson-capture never floods review requests, while every change still gets a PR trail and a CI gate. Where the repo has no CI, GitHub lands it as soon as it's mergeable. This writes only the repo's *own* local packs (not the shared canon). A run that finds nothing and opens nothing is fine — and common. (A new check must ship green — see it fail on a violating fixture, pass on a clean one — so CI stays green and the PR can merge; a check that can't be made confident lands its lesson as prose instead, never a broken check.)

## Tracking: log each run under the task's own issue

The task's standing log is the issue titled exactly, in this repo:

> **Claudinite tracker: Growth Extract**

Find it **by that exact title, never a fuzzy match or a hard-coded number** (a bare number can dangle, and it differs per repo). A run that finds no issue under the exact title just creates one (closed). **Never open, close, or reopen it** afterward — its state carries no meaning, only the log does. When a run adds a lesson, log it as a **dated comment** — not a sub-issue — so the issue accumulates a scrollable history, each entry naming **what was added and where**.

## Run on a capable model

Deciding whether a lesson is genuinely new and durable — and deduping it against what's already documented — is a **judgment call**, not mechanical extraction. A downgraded model adds noise or restates what's there, and **auto-merge means no human reviews the PR before it lands** — CI gates correctness, not whether a "lesson" earns its keep — so the capable-model requirement matters all the more. This task declares `model: opus`; the executor dispatches its subagent there.

## What this task must never do

- **Never touch the shared canon** — this task writes only the repo's *own* local packs under `.claudinite/local/packs/`; everything else under `.claudinite/` is the read-only mount, and lifting a lesson up into the canon is the central promote task's job.
- **Never widen past the Context window** — the substantive commits and touched PRs/issues named there are the scope; do not re-decide it.
- **Don't add noise** — a duplicate or hallucinated "lesson" is worse than adding nothing, the more so when its PR auto-merges with no human review to catch it.
