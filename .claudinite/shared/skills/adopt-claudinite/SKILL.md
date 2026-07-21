---
name: adopt-claudinite
description: Bootstrap Claudinite into a consuming repo — mount, hooks, checks, skills. Use when asked to bootstrap, adopt, or set up Claudinite, or to baseline a repo to pick up updates.
---

Follow [bootstrap.md](../../bootstrap.md) — canonical there, and idempotent by design. Under the
vendored mount it is: fetch the canon once (the one network moment), `--init` the pack
declaration + run the adoption interview, vendor the snapshot into tracked
`.claudinite/shared/` (`mount/apply-vendor.mjs` — whole-set + stamp), track it, register the
single SessionStart orchestrator plus the Stop/PreToolUse hooks at their `shared/` paths, add
the `@.claudinite/shared/CLAUDE.md` import + self-check, copy the CI backstop stub, open the
maintenance-enrollment issue, categorize the project, and land the sweep green.

**Refreshing** an already-vendored repo on demand is the same flow minus the wiring: fetch a
fresh canon to scratch, run its `mount/apply-vendor.mjs` against the repo, commit the one
resulting change. **Never** hand-convert a legacy (fetch-at-session-start) member to the
vendored mount — that conversion is the gated flip note the nightly applies
([mount/DESIGN.md](../../mount/DESIGN.md), phase 2); until then legacy members are maintained
per bootstrap.md's transition appendix.
