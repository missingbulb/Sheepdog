# sheepdog — the fleet enforcer marker

Declaring this pack marks a repo as the **fleet enforcer**: the one repo that covers and maintains
every repo under an owner. It's opt-in — a dedicated `sheepdog` repo declares it (it is **not** seeded
by `--init`) — and it turns what used to be bespoke Claudinite fleet infrastructure into a declaration.

The pack is thin. It contributes the one piece that only a fleet enforcer needs — the **census**
([check-fleet-coverage.mjs](check-fleet-coverage.mjs), the cross-repo walk) — plus its config schema
and the coverage-workflow stub. The rest of the machinery — running the daily-run (the orchestrator),
the run_daily engine, scheduling — is Claudinite **core** (`routines/`), because baselining and the
daily-run are Claudinite's own responsibility, not the pack's. Declaring `sheepdog` adds only the
cross-repo reach: the census, the owner/exclude config, and the token that spans the fleet.

**Config** — this repo's `.claudinite-checks.json` carries, as its `packs` entry for this pack:

```json
{ "id": "sheepdog", "config": { "owner": "missingbulb", "kind": "user", "exclude": ["owner/repo-a"] } }
```

`owner` (default: this repo's owner) is who to cover; `exclude` is the repos deliberately kept out of
the fleet (a full `owner/name` each). `kind: "user"` today; org support is a later addition. This
replaces the old opt-out list — a repo is kept out by adding it here.

**How it runs** — baselining materializes the [coverage workflow](stubs/fleet-coverage.yml) into this
repo and prompts for the `FLEET_GITHUB_TOKEN` secret (a fine-grained PAT spanning the owner's repos:
Metadata + Contents read, Issues read/write, and Contents write on this repo for baseline-migration
retirement). That `workflow_dispatch`-only Action checks out Claudinite and runs this pack's census
([check-fleet-coverage.mjs](check-fleet-coverage.mjs)) with the token; it never
carries a `schedule:` of its own. This repo's single scheduled routine — the core orchestrator that
runs the daily-run ([routines/auto-all-repos-maintenance.md](../../routines/auto-all-repos-maintenance.md))
— is the one schedule ([routines/fleet/scheduling.md](../../routines/fleet/scheduling.md)).
