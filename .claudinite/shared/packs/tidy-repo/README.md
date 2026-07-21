# tidy-repo

The repo tidy-up as a composable pack: the nightly PR/branch/issue sweep, contributed to the fleet
maintenance plan the same way any pack contributes checks and skills. Declaring `tidy-repo` enrolls a
repo in the sweep; removing it is a durable opt-out (baselining never re-adds it).

**Declared pack** — no fingerprint. `bootstrap --init` seeds it into every new repo, and the one-time
`tidy-repo-seed` baseline migration seeds the existing fleet. Carries **no conformance checks** — its
work is a maintenance task, not checks. Its policy (`RULES.md`): assess PRs and branches read-only, act
only on issues.

## Maintenance task

One task, `repo-tidy`, does the whole tidy-up in a single pass:

| Runs when | The pass | smarts |
|---|---|---|
| a non-default branch, a PR, or an issue was touched (or weekly) | assess branches → assess PRs → triage issues → reconcile the tracker | medium |

The pass applies each per-object skill (`single-branch-status` / `single-pr-status` /
`single-issue-triage`) across the targets the plan hands it, then rewrites the repo's standing tracker
from their verdicts — branches and PRs **assess-only**, issues **act** (close/label/comment). Doing
dimensions-then-reconcile inside one worker means there is no ordering barrier: the unit is
independent/concurrent like every other. (It replaced four separate tasks — `branch-cleanup`,
`pr-assess`, `issue-triage`, `tidy-report` — once the skills owned the per-object method.)
