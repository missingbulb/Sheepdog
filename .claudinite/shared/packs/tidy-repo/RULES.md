# tidy-repo — the repo tidy-up policy

The nightly PR/branch/issue sweep, active wherever this pack is declared. The fleet routine runs the
pack's one maintenance task (`repo-tidy`) against a repo; this is the policy it follows. The per-object
**method** lives in the pack's skills ([single-branch-status](skills/single-branch-status/SKILL.md),
[single-pr-status](skills/single-pr-status/SKILL.md),
[single-issue-triage](skills/single-issue-triage/SKILL.md)); the same task also reconciles the
standing tracker at the end of its pass.

The one rule that shapes everything: **assess PRs and branches read-only; act only on issues.**

- **Branches, PRs — assess only.** They may be work in progress. Report which should stay and which
  are safe to close/delete; **never** delete, push, merge, or close them. Judge by *content* (the
  landed-status test), never a ref's auto-generated name.
- **Issues — act.** Take the first applicable action: close-if-implemented / needs-decision / blocked
  / quick-win / leave. "Implemented in `main`" means the issue's actual ask is true of `main`'s
  content **now** — confirm it there and cite it; when you can't, comment, don't close. Every action
  defaults to the reversible option (comment / leave) when the check is inconclusive.

The `repo-tidy` pass applies each single-object skill across the targets the plan hands it, then
rewrites the repo's standing tracker from the verdicts it gathered (one issue per repo, body rewritten
to today's state, a dated comment per run).
