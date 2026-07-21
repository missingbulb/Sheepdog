// The sheepdog pack: a MARKER + config. Declaring it on a repo makes that repo the
// fleet ENFORCER — the one that covers and maintains every repo under an owner. It's
// opt-in (a dedicated sheepdog repo declares it; NOT seeded by --init).
//
// The pack is thin: prose (RULES.md), the config schema (the pack entry's config =
// { owner, kind, exclude }), the coverage-workflow stub (stubs/fleet-coverage.yml)
// that baselining materializes into the sheepdog repo and that prompts for the
// FLEET_GITHUB_TOKEN secret, and the CENSUS it runs (check-fleet-coverage.mjs, in
// this pack) — the account-spanning coverage/adoption audit that IS the cross-repo
// reach the pack adds. Everything else — the PLANNER (routines/fleet/plan.mjs), the
// orchestrator/daily-run, the run_daily engine, scheduling — is Claudinite CORE and
// pack-agnostic; the planner never runs, dispatches, or depends on this census.
export default {
  id: 'sheepdog',
  detect: null,
  marker: null,
  prose: 'RULES.md',
  rules: [],
};
