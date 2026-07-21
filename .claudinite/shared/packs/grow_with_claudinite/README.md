# grow_with_claudinite

Opt into the **growth lifecycle** — declaring this pack enrolls a repo in contributing its hard-won
lessons up to the shared Claudinite canon, and in pruning its local packs once the canon owns them.
Seeded by default (`--init` + the one-time `grow-with-claudinite-seed` baseline migration for the
existing fleet), and **opt-out by removal**: baselining never re-adds it.

This pack carries the **member-side** stages of the growth lifecycle: capturing a repo's own
lessons into its local packs, and pruning them once the shared canon covers them. The central
**promote** stage — which lifts portable lessons up into the shared canon — is a home-only duty
that runs centrally, not a member-side task, so it lives outside this pack.

Its scheduled work is three `run_daily` tasks, all ordinary, independent planner units:

| Task | Runs when | Where it lands |
|---|---|---|
| `growth-extract-new-instructions` ([extract.md](extract.md)) | the project changed in the window | the project's own local packs, via a PR that auto-merges after CI |
| `growth-dedup-local-instructions` ([dedup.md](dedup.md)) | canon changed, or the project's local packs changed (or weekly) | a PR against the project's `main` |
| `growth-discover-packs` ([discover-packs.md](discover-packs.md)) | the member's weekly full sweep | one PR per authored pack, against Claudinite's canon |

A member that wants the local stages without contributing lessons upstream **opts out of
promotion** on its own entry — `{ "id": "grow_with_claudinite", "config": { "promote": false } }`
— and the central promote stage skips it (absent or `true` = participate).

## The conversation lifecycle — capture at merge, extract in a daily task, retention

The pack also owns **extraction from working sessions** — the conversation-side sibling of the
issues/PRs/commits extract above, replacing the old in-session post-merge lessons pass. The two
halves split by what each needs: **capture** needs the live session transcript, so it runs
in-session at merge; **extraction** only reads the already-pushed logs, so it is an ordinary
fleet `run_daily` task with `growth-extract`'s access model — the logs branch is *in the repo*,
so reading it, committing lessons to local packs, and pruning are plain local git on the working
tree; only posting the dialogue on the issue uses the GitHub MCP tools.

1. **Capture — a step in the merge-to-main skill** (in-session, where the transcript lives).
   Right after a merge lands:
   `node .claudinite/shared/packs/grow_with_claudinite/capture-log.mjs --issue <n>`
   (in the canon repo itself: `node packs/grow_with_claudinite/capture-log.mjs --issue <n>`).
   Deterministic, seconds; it bundles the session transcript (sidechains inline, timestamp
   order), **scrubs enumeration-first** (every value the environment holds — `process.env`
   minus a short named allowlist of structural values, plus known credential stores — is
   redacted wherever it appears, with credential-shape patterns as the backstop; a secret the
   session itself transformed is beyond any static scrub, and push protection is the last
   net), and pushes one file per merge onto the orphan **`conversation-logs`** branch:
   `<stamp>--issue-<n>--<session>.jsonl`, commits marked `[skip ci]`. **Delta-aware:** a
   session that merges twice pushes a second, disjoint file for the second merge's issue.
   The branch is a **work queue, not an archive** — never merged; tips are cheap in shallow
   session clones and retention keeps them bounded.
2. **Fresh pass — the [conversation-extract](conversation-extract.md) run_daily task** (gate: the
   day after a real merge — `substantiveChange` — plus the weekly full sweep; local git on the
   repo's working tree, MCP only for the issue comment). It applies
   [extracting-lessons.md](extracting-lessons.md) (the method — friction signals and the
   measured efficiency analysis, computable from the log's timestamps and token usage), routes
   keepers into the member's local packs, and posts the rendered dialogue
   ([render-dialogue.mjs](render-dialogue.mjs)) on the worked issue for each rule that landed —
   **extraction is the only path to permanence**: a log that yields no rule gets no comment,
   and its conversation is gone once retention deletes it (a deliberate owner call).
3. **Final pass and deletion** — once a log ages past `config.retention_days`, the same task
   re-reads it with ~a week of hindsight (the rethink window), then deletes it (the weekly full
   sweep guarantees the prune runs even on a repo gone quiet). Every log gets exactly two
   judgment passes. **Unset retention = the prune deletes nothing** (capture-only, fail-safe).

Adoption asks only for the `retention_days` value (10 recommended) — nothing to schedule, since
extraction rides the fleet's one daily run like the other growth tasks.

## Rules

| Rule | Kind | What |
|---|---|---|
| `growth-config` | hardcoded ([config-check.mjs](config-check.mjs)) | entry config shape valid |

**Pack discovery** ([discover-packs.md](discover-packs.md)) is an ordinary `run_daily` task — the
planner picks it up per member on its weekly full sweep. For the member it's handed it runs the
whole pipeline: manifest the stack, suggest a pack for each technology no pack yet owns (on first
sight), populate it with rules and checks distilled from that member's real usage, and open one
canon PR per pack. Like every worker it **executes centrally** (home session, fleet token) — that's
how it writes the canon — but it's scheduled the regular way; over a week the staggered full sweep
covers the fleet, and the shelf + open-PR check keeps first sight from double-authoring.

## Identifying a project's capture surface: its local packs (the same way in every stage)

Every growth stage operates on a project's **local packs** — the tracked packs a repo keeps under
`.claudinite/local_packs/<pack>/` (prose in `RULES.md`, checks in the pack's `rules`, activity
procedures as the pack's skills, `run_daily` tasks). That subtree **is** the project's own content;
the rest of `.claudinite/` is the **read-only mounted canon** and is never a capture, prune, or
promote target. So "a project's local packs" means precisely *everything under
`.claudinite/local_packs/`, and nothing else under `.claudinite/`*. This is the normalized capture
surface — a structural set the stages read the same way, not a `CLAUDE.md`-graph walk over stray
Markdown (a repo with no local packs yet simply has nothing to extract, dedup, or promote here; a
project adopts the structure via the `generate-project-instructions` skill).

Prefer the strongest mechanism the lesson allows — the **local promotion ladder**, applied at the
project's own level: a deterministic rule becomes a **check** in the owning pack's `rules` (its
failure message carries the lesson), an activity-scoped procedure becomes a **pack skill**, and only
what neither can carry lands as **prose** in a pack's `RULES.md`. A check relieves every session's
context completely where prose only relocates it, so capture writes *more checks and less prose*.

The stages differ only in *how they read that set*, never in *which set it is*: extract and dedup
run against the member repo and read the local packs from the working tree; promote runs centrally
and reads the same subtree over the GitHub API (get-file-contents under `.claudinite/local_packs/`).
Extract writes into it, promote reads from it, dedup prunes within it — all against the identical,
`.claudinite/local_packs/`-rooted set.
