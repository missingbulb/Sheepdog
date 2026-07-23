# Growth — dedup local packs against the canon (per repo)

The growth lifecycle's pruning stage: reconcile this repo's **local packs** against the shared **canon** it
consumes (Claudinite, vendored read-only), pruning local items — a pack's prose line, or a whole local check —
the canon now covers. It opens a PR against the repo's default branch for the owner to approve. Often there's
nothing to prune, and that's fine. You run under the executor, dispatched by a `ready-for-agent` issue; when
its Context names the newly-changed canon packs, focus the re-check there.

> This task only prunes local packs against the canon; lifting local items up into the canon is the central
> promote task's job (canon-side).

## Conventions used in this doc

- **Default branch.** `main` stands for **this repository's default branch** — substitute whatever the repo uses.
- **GitHub access is MCP-native.** Updating the tracking issue and opening the PR go through the session's
  **GitHub MCP tools** (`mcp__github__*`). The unattended run has no shell GitHub access — the shell reaches
  only a git-over-HTTPS proxy scoped to one repo, with no REST credential — so never reach for `gh`/`curl` or
  a cross-repo clone.
- **The mounted canon.** The exact canon revision this repo currently consumes — compare against *that*, not a
  live fetch. It is what `.claudinite/shared/` holds at the mount's stamp (a promotion is visible here only
  once baselining has converged the mount to include it). Prune only against what the repo actually mounts.
- **The repo's local packs.** The set identified in [this pack's README](../../README.md#identifying-a-projects-capture-surface-its-local-packs) —
  everything under `.claudinite/local/packs/` (the legacy `.claudinite/local_packs/` accepted during the
  rename window). That's the corpus this task prunes within; the read-only mounted canon elsewhere under
  `.claudinite/` is never a prune target, only the yardstick you prune *against*.

## What it does: prune / rephrase local packs the canon now covers

When the canon has **absorbed** a practice a local doc still carries — most often an item the central promote
task lifted up and the canon now owns — the local copy is redundant. This task:

- **Removes** the now-duplicated local item, since the canon is the single source of truth for portable rules.
- **Rephrases** a local procedure when the canon's wording of the same idea has changed, so the local packs
  stay consistent with the canon they point at.

**Keep a local item only if it says *more* than the canon — not merely says it more specifically.** Every
local item is more specific than the canon, so specificity alone is never the test. Distinguish two cases:

- **The general rule in local dress** — it makes the canon's point but leans on this repo's classes, files, or
  names to make it. Once the canon covers the point, those names were only illustration: prune it.
- **A stronger point about a narrower case** — it asserts something the canon's general rule leaves out: a
  tighter constraint, a sharper claim that holds for this repo's narrower situation. Keep it.

So ask not "is it specific" (it always is) but "does it only lean on specific names to make the general point,
or does it make a point the canon doesn't?" Prune the first; keep the second.

## A canon check covers an item too — and more strongly than prose

The canon carries rules as **conformance checks**, not only prose. A local item is covered when a canon check
*enforces* it — stronger coverage than a stated line, since the rule runs on every session and CI pass.
Consult the machine-readable rule catalog (`node .claudinite/shared/engine/checks/check_the_world.mjs --list`:
id, severity, description, doc pointer — it lists the active local packs' own checks too) alongside the prose
corpus, and when a check covers the item, **quote the rule id** where you'd otherwise quote a canon line. This
cuts both ways: a **local pack's own check** is redundant once a canon check enforces the same rule — prune the
local `.mjs` (and drop it from `pack.mjs` + its fixture) exactly as you'd prune a duplicated prose line. The
keep-test above is unchanged: a local item that says *more* than the check detects (a stronger point about a
narrower case) stays.

## Discipline

- **Only remove a local item you can show the mounted canon genuinely covers — quote the canon line (or the
  covering check's rule id).** When unsure, leave it; a wrongful prune deletes a real local lesson.
- **Open a single PR against `main`** from a per-run-unique branch — one PR for the whole run's prunes, not one
  per item — never a direct push. This is an unattended task, on a capable model, and a **wrongful prune
  deletes a real local lesson**, so — unlike [growth-extract](../growth-extract/task.md), whose additive edits
  ride a PR that auto-merges after CI — this task keeps a **human** approval gate (its declared outcome ceiling
  is `open-pr`: it may open a PR but never merge it). **Put the issue reference in the commit message** —
  `Refs #<n>` for this task's tracking issue (below), in the commit itself, not only the PR body. The repo's
  `basics` `task-lifecycle` check gates a PR on its commits referencing an issue, so a prune commit that cites
  none reds the repo's CI and blocks the merge.
- If an edit touches something a test reads, run the repo's offline test suite and keep it green before pushing.

## Tracking

The task's standing log is the issue titled exactly, in this repo:

> **Claudinite tracker: Growth Dedup**

Find it **by that exact title, never a fuzzy match or a hard-coded number**. A run that finds no issue under
the exact title just creates one (closed). **Never open, close, or reopen it** afterward — its state carries no
meaning, only the log does. Log each run that changed a doc as a **dated comment** — naming what was pruned and
the canon line that now covers it. A run that prunes nothing logs nothing.

## Run on a capable model

Proving the mounted canon genuinely covers a local item before pruning it — and telling "the canon now owns
this" from "the canon states this too generally, keep the local cut" — is a **judgment call**. A downgraded
model prunes a real lesson; the review PR is a backstop, but a wrongful prune is easy to wave through in
review, so don't lean on it. This task declares `model: opus`; the executor dispatches its subagent there.

## What this task must never do

- **Never edit the read-only canon** — it only prunes the repo's *local packs* against it.
- **Never merge its own PR** — the human approval gate is the whole point (`outcome: open-pr`).
- **Never prune a local item without quoting the mounted-canon line (or covering check rule id) that covers
  it** — when unsure, leave it.
- **Never prune a local item that makes a stronger point about a narrower case** than the canon — that isn't
  redundancy. (A local item that only restates the canon in repo-specific names *is* prunable once the canon
  covers the point.)
