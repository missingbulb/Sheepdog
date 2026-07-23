# baselining worker

The per-repo **self-refresh**: converge THIS repo's vendored mount to the current canon head, apply the
migration notes that landed since its stamp, and advance the stamp — one transactional commit on the
`claudinite/maintenance` PR. You run under the executor (dispatched by a `ready-for-agent` issue), not the
old fleet planner, and your session sources include a **read-only canon checkout** alongside this repo —
that checkout is where the canon head snapshot and the migration notes come from. GitHub writes go through
the session's **GitHub MCP tools** (`mcp__github__*`); reads of the canon tree are plain filesystem reads of
the in-session checkout.

The dispatch issue's **Context section is binding scope** — the canon head sha to converge to and the stamp
date the notes are gated on are precomputed there; do not re-decide them.

## The transactional refresh

Read this repo's `.claudinite-checks.json` — the `claudinite` stamp says which canon revision the mount is
at ([vendoring/DESIGN.md](../../../../vendoring/DESIGN.md)):

- **Vendored repo** (`"claudinite": { "updated": …, "ref": … }` present) — perform the transactional
  refresh. First **verify the checkout**: the canon checkout in this session must be at the canon's **remote**
  default-branch head (compare the canon head sha the Context names against the checkout's `git rev-parse
  HEAD`) — a lagging checkout would silently rewind this repo's whole vendored corpus, so a mismatch is this
  task's failure, never a tree to converge from (#328). Then:
  1. **Apply the pending migration notes** — every `migrations/active_migrations/` record in the canon dated
     **on or after the day** of this repo's `updated` stamp, oldest first (mechanical ops, plus following a
     note's agentic instructions where it carries them). Same-day **inclusive**: the stamp's day can't order
     against a day-dated note, so a note landing later on the stamp's day must still apply (#330); notes are
     idempotent (mechanical ops by construction, agentic instructions preconditions-first), so the
     re-application this admits is safe.
  2. **Converge `.claudinite/shared/`** to the canon head snapshot — this repo's vendor set per
     [vendoring/compute-vendor-set.mjs](../../../../vendoring/compute-vendor-set.mjs) (the engine/ root minus
     tests and docs, plus the declared packs with their `requires` closure — bundled skills riding each pack's
     own tree), written copy-if-different **and** deleting files in `shared/` the set no longer contains.
     Unconditional: a repo-side edit to a vendored file reverts here, visibly in the diff. Never touch
     `.claudinite/local/packs/` (or the legacy `.claudinite/local_packs/`) or anything outside `shared/`
     except what a note names.
  3. **Advance the stamp** — `{ "updated": "<full ISO datetime>", "ref": "<verified canon head sha>" }` —
     **in the same commit as steps 1–2's writes**: the stamp gates which notes apply, so it must never
     advance in a commit that lacks a pending note's ops (#329).
  If any part fails **before that commit, write nothing** — the repo keeps running its old snapshot
  coherently, tonight's failure converges to the dispatch issue's failure state, and the next night retries
  from the same stamp. Also keep the fresh-path wiring converged per
  [bootstrap.md](../../../../bootstrap.md) (hook registrations; delete any legacy
  `@.claudinite/shared/CLAUDE.md` import line — the corpus index is retired, #385) — additive, in-place fixes
  only, never clobbering this repo's own entries. The **scheduler wiring is part of that surface**
  (bootstrap Part 6): re-converge a drifted `.github/workflows/claudinite-scheduler.yml` to the vendored
  stub — preserving this repo's hashed cron minute, the one repo-specific value in it — and re-create any
  missing `ready-for-agent` / `agent-running` / `needs-human` / `workflow-failure` label idempotently.
  Baselining is the repair loop for every Claudinite moving part the repo carries; the conformance checks
  are the in-session guard that flags the same drift the moment it's authored.
- **Repo without a stamp** — post-migration this is drift, not a supported shape: converge it through the
  fresh-path bootstrap exactly like an adoption's mechanical part, which vendors the mount and stamps it —
  transactional, any failure writes nothing. (The precondition already self-skips a repo that has *no* mount
  at all, so you only reach this branch on genuine drift.)

Then, for a covered repo:

- **Declaration normalization** — a local pack's canonical declaration token is `local/<name>`
  ([engine/pack_loader/pack-registry.mjs](../../../../engine/pack_loader/pack-registry.mjs) `declTokenFor`).
  Rewrite any legacy (`local_packs/<name>`) or **bare** local-pack declaration in this repo's
  `.claudinite-checks.json` to that form: a declared id whose pack lives in this repo's own
  `.claudinite/local/packs/<id>/` (or the legacy `.claudinite/local_packs/<id>/`) gets the `local/` prefix;
  everything else on the entry stays verbatim, and a bare id with no such local pack is a canon declaration —
  leave it alone. Idempotent, tracked by the namespace baseline migration until the fleet converges.
- **Align** — evaluate this repo against its declared packs' *current* checks (the same engine its Stop hook
  and CI run). Apply a failing check's own `fix` remedy, **never more**; a finding needing judgment becomes an
  issue in this repo, not an edit.

## Delivery

Changes go per `maintenance.delivery` in this repo's `.claudinite-checks.json` (always explicit; a missing key
is drift — materialize `{ "maintenance": { "delivery": "auto-merge" } }`; `push`/`auto`/`pr` are accepted as
legacy aliases for `auto-merge`/`review`). **Both modes land on the stable `claudinite/maintenance` branch and
its one PR — never a direct commit to the default branch**: `auto-merge` **arms auto-merge** on that PR so
GitHub lands it once checks pass with no human review (what keeps nightly maintenance from piling up as review
requests); `review` leaves the PR for the owner (never auto-merged); an unrecognized value commits nothing and
opens an issue naming it. This is the task's declared `merged-pr` ceiling — a repo whose `maintenance.delivery`
is `review` degrades it to `open-pr` (member config wins, DESIGN §1).

The refresh lands as **one `push_files` commit** on that branch regardless of delivery mode — notes + converge
writes + stamp never split. The one thing that can't ride it: file **deletions** (convergence pruning a file
the set dropped, or a note's delete) — MCP has no multi-file+delete, so they follow immediately as their own
`delete_file` commits, **after** the stamped content commit (#329). Trailing deletes are safe to interrupt:
the next night's unconditional convergence re-deletes any straggler, whereas note ops are stamp-gated and so
must always land with the stamp.

## Never

Touch the read-only canon checkout (it is the source, never a write target); let alignment edit beyond a
failing check's own remedy; merge a delivery PR by hand (the `auto-merge` lane arms GitHub's auto-merge, which
lands it once checks pass — the worker never clicks merge); advance the stamp in a commit missing a pending
note's ops; or guess a delivery preference.
