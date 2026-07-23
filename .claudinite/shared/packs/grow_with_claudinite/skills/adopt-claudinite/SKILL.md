---
name: adopt-claudinite
description: Bootstrap Claudinite into a consuming repo — mount, hooks, checks, skills. Use when asked to bootstrap, adopt, or set up Claudinite, or to baseline a repo to pick up updates.
---

Follow [bootstrap.md](../../../../bootstrap.md) — canonical there, and idempotent by design. Under the
vendored mount it is: fetch the canon once (the one network moment), `--init` the pack
declaration + run the adoption interview, vendor the snapshot into tracked
`.claudinite/shared/` (`vendoring/apply-vendor-set.mjs` — whole-set + stamp), track it, register the
single SessionStart orchestrator plus the Stop/PreToolUse hooks at their `shared/` paths, wire the
world-scope sweep into the project's test/CI flow (its own `check_the_world.mjs` step — adding a
minimal flow if the repo has none; the Stop hook carries only the work-scope checks), open the
maintenance-enrollment issue, categorize the project, and land the sweep green.

**Refreshing** an already-vendored repo on demand is the same flow minus the wiring: fetch a
fresh canon to scratch, run its `vendoring/apply-vendor-set.mjs` against the repo, commit the one
resulting change. **Never** hand-convert a legacy (fetch-at-session-start) member to the
vendored mount — that conversion is the gated flip note the nightly applies
([vendoring/DESIGN.md](../../../../vendoring/DESIGN.md), phase 2); until then legacy members are maintained
per bootstrap.md's transition appendix.
