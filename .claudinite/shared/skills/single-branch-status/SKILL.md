---
name: single-branch-status
description: Assess one branch's landed status — merged, already-in-main, superseded, orphaned, or genuine unmerged work — read-only. Use when triaging whether a single branch is safe to delete, judging by content not the ref's name (e.g. the tidy-repo repo-tidy task hands you branches to assess).
---

# Single-branch status

Assess **one** branch and return a verdict. **Assess-only — never delete, push, or merge.** Judge by
**content**, never the ref's auto-generated or repurposed name.

`main` = the repo's default branch. Take the **first** that applies (squash-merge makes "commits
ahead" meaningless, so never judge by commit count):

1. Its PR merged ⇒ **merged** (in `main`).
2. `git diff --stat origin/main..origin/<branch>` empty ⇒ **stale** (already in `main`).
3. Its intent is present in `main` under another path or form ⇒ **superseded** (grep the *concept*,
   not the filename).
4. `git merge-base origin/main origin/<branch>` fails ⇒ **orphaned** — a human must look; never
   auto-anything.
5. Else ⇒ **unmerged** (genuine work).

Return `{ status, note }` — `status` one of merged/stale/superseded/orphaned/unmerged. For `unmerged`,
the note says what it carries; for merged/stale/superseded, recommend deletion (never perform it);
for orphaned, flag for a human. In a git-proxy-only sandbox, read commits + diff over the API/MCP,
never a clone.
