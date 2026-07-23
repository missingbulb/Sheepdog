# Conversation extract — the growth pack's conversation-side daily task

The conversation-side sibling of [extract.md](extract.md): mine a repo's captured conversation
logs for durable lessons, post the dialogue behind each extracted rule on the issue it was worked
under, and prune logs past retention. It runs with the same access model as `growth-extract` —
the repo's own content is plain **local git** in the checkout; only the GitHub **issue API** goes
through MCP. (Capture, which needs the live session transcript, is the separate in-session step at
merge; this task consumes what capture already pushed.)

The **method** — the friction signals, the measured efficiency analysis, the lesson bar — stays
canonical in [extracting-lessons.md](extracting-lessons.md) and is not restated here. The captured
log carries what that method needs: per-entry timestamps, per-message token usage, and the
tool_use/tool_result pairs behind wall-time numbers.

## Conventions used in this doc

- **Default branch.** `main` stands for the repo's default branch — substitute whatever it uses.
- **Access split — local git for repo content, MCP for PRs and the issue API.** Reading the
  `conversation-logs` branch and its files, staging the `.claudinite/local_packs/` lesson onto a
  branch, and the retention prune are all **plain git in this repo's checkout**
  (`git fetch`/`show`/`rm`/`push`) — the branch is *in this repo*, so no cross-repo access is
  involved, exactly as `growth-extract` reads `git log` and stages its lessons. Opening the lesson
  PR and arming its auto-merge, posting the dialogue, and the tracking-issue log go through the
  session's GitHub MCP tools (`mcp__github__*`) — none of those is a plain-git operation.
- **The project's local packs.** Everything under `.claudinite/local_packs/` — the project's own
  packs (the canon home repo's own is `.claudinite/local/packs/claudinite/`); never the read-only
  mounted canon elsewhere under `.claudinite/`.

## The run

1. **Fetch the queue.** `git fetch origin conversation-logs`; list its files
   (`git ls-tree --name-only origin/conversation-logs`). No branch, or no `*.jsonl` → stop; a quiet
   repo is the common, valid outcome.
2. **Read retention.** From this repo's `.claudinite-checks.json`, the grow_with_claudinite entry's
   `config.retention_days`. Unset → the prune in step 5 is skipped entirely (capture-only adoption).
3. **Fresh pass.** For each log captured in the recent window (its filename carries the capture
   stamp; corpus dedup makes an overlapping re-read harmless, so err toward re-reading the last
   several days): read it (`git show origin/conversation-logs:<file>`) and run the
   extracting-lessons method over it — including the wall-time/efficiency analysis, measured from
   the log's own timestamps, never hand-waved.
4. **Route, land, and post.** Fold each keeper into the repo's **own local packs**
   (`.claudinite/local_packs/`) at the local promotion ladder's strongest mechanism, exactly as
   extracting-lessons.md prescribes — landing the whole run through **one auto-merging PR** (title
   `Claudinite growth: conversation extract`, its commit referencing the worked issue so the
   `task-lifecycle` gate passes), armed for auto-merge the same way [extract.md](extract.md)
   delivers: GitHub squash-merges it once the repo's checks pass, with no human review. For each
   rule that actually landed, render its
   source log's dialogue — `node packs/grow_with_claudinite/render-dialogue.mjs
   <(git show origin/conversation-logs:<file>) --max-chars 60000` — and post it via
   `add_issue_comment` on the issue named in the log's filename (`--issue-<n>--`), one comment per
   chunk, opening with one provenance line (the rule added, the capture date, the session id). A
   log that yields nothing gets **no** comment — extraction is the only path to permanence. Finding
   nothing at all is fine and common.
5. **Retention prune.** When `retention_days` is set: for each log whose filename stamp is older
   than `retention_days` days, give it a **final hindsight pass** — one last read against the
   now-current corpus (steps 3–4 apply to anything it still yields) — then `git rm` it on the
   `conversation-logs` branch and push (commit message ending `[skip ci]`). The branch is never
   merged and its history is never rewritten — plain add/remove commits only.

## Tracking: log each run under the routine's own issue

The standing log is the issue titled exactly **`Claudinite tracker: Conversation Extract`** in this
repo — found by that exact title, never a number; created **closed** if missing; its state never
changed afterward. When a run lands a lesson, posts dialogue, or prunes logs, log it as one dated
comment (via `add_issue_comment`) naming what changed; a run that changed nothing logs nothing.

## Run on a capable model

Whether a lesson clears the bar — and whether the hindsight pass should overturn a fresh-pass
call — is the judgment this task exists for, and its PR auto-merges without a human review gate. Its
`smarts: high` names the tier; run it there.

## What this task must never do

- **Never merge `conversation-logs`** anywhere, and never rewrite its history — plain add and
  remove commits only.
- **Never post raw JSONL to an issue** — only the rendered dialogue, chunked under the comment
  size cap.
- **Never delete a log younger than retention, and never delete anything while `retention_days` is
  unset** — deletion is the ack that both passes happened.
- **Never touch the shared canon** — writes go to the repo's own `.claudinite/local_packs/` (via an
  auto-merging PR), its issues, and its logs branch; lifting portable lessons is the central promote stage's job.
