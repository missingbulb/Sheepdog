# sheepdog

The fleet **enforcer** marker — declaring it makes a repo the one that covers and maintains every repo
under an owner. Opt-in (a dedicated sheepdog repo declares it; **not** seeded by `--init`). It
standardizes the fleet coverage that used to be bespoke Claudinite infrastructure into a declaration.

Thin by design: prose + the config schema (the sheepdog pack entry's `config` = `{ owner, kind, exclude }`) + the
coverage workflow stub baselining materializes. The machinery it drives — the census, running the
daily-run, the run_daily engine, scheduling — is Claudinite **core** (`routines/`). Carries no
conformance checks and no `run_daily` task of its own. Policy + config: [RULES.md](RULES.md).
