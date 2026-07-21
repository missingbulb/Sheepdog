---
name: single-pr-status
description: Assess one open pull request's landed status — keep-open, or closeable (merged, already-in-main, superseded, stale) — read-only. Use when triaging whether a single PR should stay open, judging by its commits and diff not its title (e.g. the tidy-repo repo-tidy task hands you PRs to assess).
---

# Single-PR status

Assess **one** open pull request and return a verdict. **Assess-only — never close, merge, or comment
on it.** Read status from its **commits + diff**, never the PR title.

`main` = the repo's default branch. Take the **first** that applies:

1. Merged ⇒ **merged** (done).
2. `git diff --stat origin/main..<head>` empty ⇒ **stale** (already landed).
3. Its intent is present in `main` under another form ⇒ **superseded**.
4. `git merge-base` with `main` fails ⇒ **orphaned** — a human must look.
5. Else ⇒ **open** (genuine work that should stay).

Return `{ status, note }` — `status` one of merged/stale/superseded/orphaned/open. For `open`, the
note says why it's live (`#N — why`); for merged/stale/superseded, recommend closing (never close it).
In a git-proxy-only sandbox, read over the API/MCP, never a clone.
