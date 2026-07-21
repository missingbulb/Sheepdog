# Growth — discover packs (a run_daily task, executed centrally)

The pack-discovery pipeline, run as an ordinary **`run_daily` task** — the planner picks it up per
member on that member's **weekly full sweep**, and the orchestrator dispatches it like any other unit
(member-scoped, where the central promote stage is home-only). For the member it's
handed, it runs the whole pipeline end to end — **manifest → suggest → populate → open PR** — as one
process. It is Claudinite-internal; consuming repos don't vendor or `@import` it.

**Per member, executed centrally.** Like every worker, it runs in the home-repo routine session with
the fleet token, and reads the member and writes the **canon** over the API. So "central" means *where
it runs and what it can write* (it opens PRs against the canon, which a member-sandboxed session can't),
while *scheduling* is the regular per-member weekly stagger — no special-casing. Over a week the whole
fleet is covered, ~1/7 per night; **first sight wins** — the first member whose run hits an unhomed
technology authors its pack, and the rest see it on the shelf and skip.

**The steps are distinct, not conflated.** Cataloguing the member's stack (step 1) and judging whether
the canon needs a pack (step 2) are different levels of analysis — step 1 decides nothing about packs.
They are sequential steps of one task, not one merged judgment.

## The governing principle — distilled from worked examples, never from imagination

A pack this task authors is *distilled from worked examples, not written from imagination* — the
constraint that makes automated authoring safe. **The member actually using the technology is the
worked example.** Every rule must trace to how it really uses the technology — a real build config, a
real packaging/signing step, a gotcha already in its docs — and be cited. **Never pad** with
speculative best-practice rules the evidence doesn't demonstrate; a rule you can't ground, you don't
write. A smaller honest pack beats a padded one. And **never open an empty stub to fill later** — the
point is to populate it now (step 3).

## Run on a capable model

The task's `smarts` is `high`: past step 1 every step is heavy judgment — is a technology genuinely
unhomed, which usage is a portable rule vs. this member's one-off, does a rule mechanize into a check,
what fingerprint reliably detects the technology. Per [the unattended-agents skill](../../skills/unattended-agents/SKILL.md)
("match the agent model to the judgment it must make"), the worker runs on a capable tier.

## Conventions used in this doc

- **The member.** The one repo this unit was dispatched against (`repo` in the plan unit). Read it over
  the API — you run centrally, not inside it.
- **The canon.** The Claudinite home repo, where authored packs land. You open PRs here, with the fleet
  token.
- **GitHub access is MCP-native.** Reading the member and opening the canon PR go through the session's
  **GitHub MCP tools** (`mcp__github__*`); the fleet run has no shell GitHub access and no cross-repo
  checkout, so never reach for `gh`/`curl`.

## The pipeline

### Step 1 — manifest the member's stack

Produce a manifest of what the member is built on and how it ships, by reading its files over the API.
This step **only catalogues** — it does not look at the pack shelf or judge whether anything deserves a
pack. Run it with this instruction:

> Produce a **manifest** of what this project is built on and how it ships — a comprehensive,
> evidence-grounded inventory. You are **only** observing and cataloguing. You are **not** deciding
> anything about tooling, packs, standards, or what should change; you make no recommendations, and you
> do not compare this repo against anything outside it.
>
> **Ground every entry in the repo's files** — dependency and build manifests, lockfiles, toolchain and
> config files, CI and release workflows, packaging and signing scripts, the source structure, and the
> docs. For each entry, cite the concrete evidence — the file (and the line/section or step) that proves
> it. Never infer from "projects like this usually…"; if the repo doesn't show it, it is not in the
> manifest. If something is present but appears vestigial or aspirational (declared but unused), include
> it and say so.
>
> Catalogue across **three axes**. Put each item under the single axis that fits best; when it genuinely
> spans two, place it under the primary and cross-note the other.
>
> 1. **Technologies** — languages and their versions, runtimes, frameworks, build systems, and the major
>    libraries that shape how you write and build here (the load-bearing ones, not every transitive
>    dependency). Evidence: manifests, lockfiles, toolchain/config.
> 2. **APIs & external services** — every third-party service, cloud API, SDK, auth provider, datastore,
>    message bus, or external integration the code actually talks to. Evidence: client SDK dependencies,
>    config/env keys, call sites.
> 3. **Deployments & distribution** — how and where this ships: packaging format(s), distribution
>    channel(s), the runtime/host it targets, signing/notarization, and the release mechanism. Evidence:
>    release workflows, packaging and signing scripts, deploy config.
>
> For **each** item report: **name**; **axis**; **evidence** (the file(s), and what they show); **what
> it is in this repo** (one line); **prominence** — one of `core` (the project is built on it),
> `supporting` (used but peripheral), `vestigial` (present but apparently unused); and a **`?` flag** if
> you are uncertain the item is real or correctly characterised. Prominence is a factual read of how
> central the item is *in this repo* — **not** a judgment about whether it deserves any downstream
> treatment.
>
> Be **comprehensive over concise**: a later step filters and decides, so a true item you omit is lost,
> while an over-included one is cheaply dropped. When unsure whether something rises to an entry, include
> it with the `?` flag. Do **not** deduplicate against, reference, or even consider any pack, tool, or
> catalogue outside this repository.
>
> Output the manifest as Markdown grouped under the three axis headings, one bullet per item with the
> fields labelled.

### Step 2 — suggest new packs

Now check the manifest against the canon's pack shelf (`packs/`). A technology is **homed** — drop it —
when any pack owns it, **a stub pack included**. Also drop anything with an **open pack-authoring PR**
on the canon (another member's earlier run this week may have authored it — this is the first-sight
dedup), and anything the manifest marked **`vestigial`** (declared-but-unused is not a real sighting).
What remains is this member's candidate set — **suggest a pack for each, on first sight** (don't wait
for the technology to recur).

### Step 3 — populate the pack

For each candidate, **author a populated pack** by distilling from how the member actually uses the
technology — its build/toolchain config, CI and release workflows, packaging/signing scripts, relevant
source, and any gotchas already in its docs. Apply [generate-project-instructions](../../skills/generate-project-instructions/SKILL.md)'
method (don't re-derive it): strip the origin project, keep what's true for the technology, and descend
the promotion ladder ([checks/DESIGN.md](../../checks/DESIGN.md)) —
a rule a deterministic check can carry becomes the **check plus a fixture test** (it fires on a
violating input, stays quiet on a clean one), a procedure with a nameable trigger becomes a skill the
pack requires, and only signature-less judgment lands as `RULES.md` prose. Ground and cite every rule;
never pad. Write the four-file pack — `RULES.md`, `pack.mjs` (add the `marker`/`detect` fingerprint when
the technology carries a reliable one, so it self-declares on future repos; `detect: null` otherwise),
`README.md` (rule table + a **provenance line** naming the member it was distilled from), and the index
rows ([packs/README.md](../README.md), plus [CLAUDE.md](../../CLAUDE.md) for a new pack *kind*).

### Step 4 — open one PR per pack

Push each authored pack to a per-run-unique branch (see [the git-github-advanced skill](../../skills/git-github-advanced/SKILL.md))
and open **its own PR** against the canon's default branch — never a direct push, and never several packs
in one PR. A new pack is reviewed differently from a rule addition, so each earns its own review surface.
The write surface is bounded to the new `packs/<tech>/` directory (with any check's registration and
fixture) plus its index rows. Keep the commit and PR terse, and **put the issue reference in the commit message** — `Refs #<n>` for this task's tracking issue (below), in the commit itself, not only the PR body. The canon's `basics` `task-lifecycle` check gates a PR on its commits referencing an issue, so a commit that cites none reds CI and blocks the merge.

## Tracking issue

The task's standing log is the issue titled exactly, on the **canon**:

> **Claudinite tracker: Pack Discovery**

Find it **by that exact title, never a fuzzy match or a hard-coded number**.

**One-time rename (drop once the fleet has converged):** if no issue carries this title yet, look for
one titled exactly `Auto-Improvements Tracker - Pack Discovery` (the old name). If found, rename it to
`Claudinite tracker: Pack Discovery` and close it if it's open — do this once, then use the new title
on every later run. If neither title is found, create the new one (closed).

**Never open, close, or reopen it** afterward — its state carries no meaning, only the log does. Log
each run as a **dated comment**: the member processed, and per authored pack the technology, the rungs
its rules landed on (check ids / skills / prose); for a candidate you found nothing groundable for, name
it and why.

## What this task must never do

- **Never conflate steps 1 and 2** — the manifest step catalogues and never consults the pack shelf; the
  suggest step is where the shelf and the pack decision come in.
- **Never author from imagination or pad** — every rule traces to the member's real usage; an
  ungroundable rule is not written. The pack may be small; it may not be invented.
- **Never open an empty stub to fill later** — populate it now (step 3).
- **Never re-author an existing pack** — a stub counts as a home, and an open pack-authoring PR counts as
  in progress. Dedup against both; a pack that exists is the central promote stage's to fill, not this
  task's to replace.
- **Never author for a `vestigial` technology** — declared-but-unused is not a real sighting.
- **Never exceed the bounded write surface** — per pack, only its new `packs/<tech>/` directory (and any
  check's registration + fixture) plus the index rows, in its own PR. Never alter the member or an
  unrelated pack.
