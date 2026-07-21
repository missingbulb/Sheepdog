# baselining worker

Restore the repo the plan hands you to the current canonical baseline. Works entirely over the session's
**GitHub MCP tools** (`mcp__github__*`) — never a clone, and no shell GitHub access in the fleet run.

First read the member's `.claudinite-checks.json` and branch on its mount shape — the `claudinite`
stamp is the discriminator ([mount/DESIGN.md](../../../mount/DESIGN.md)):

- **Vendored member** (`"claudinite": { "updated": … }` present) — perform the **transactional
  refresh**. First **verify the checkout**: the canon checkout this session runs in must be at
  the canon's **remote** default-branch head (one MCP read of the head sha vs `git rev-parse
  HEAD`) — a lagging checkout would silently rewind the member's whole corpus, so it is this
  unit's failure, never a tree to converge from (#328). Then:
  1. **Apply the pending migration notes** — every `migrations/active_migrations/` record in the
     canon dated **on or after the day** of the member's `updated` stamp, oldest first
     (mechanical ops, plus following a note's agentic instructions where it carries them).
     Same-day **inclusive**, because the stamp's day can't order against a day-dated note — a
     note landing later on the stamp's day must still apply (#330); notes are idempotent
     (mechanical ops by construction, agentic instructions preconditions-first), so the
     re-application this admits is safe.
  2. **Converge `.claudinite/shared/`** to the canon head snapshot — the member's vendor set per
     [mount/vendor.mjs](../../../mount/vendor.mjs) (engine roots minus tests and root docs, the
     packs/skills machinery, the declared packs with their `requires` closure, their skills
     union, the corpus index), written copy-if-different **and** deleting files in `shared/` the
     set no longer contains. Unconditional: a member-side edit to a vendored file reverts here,
     visibly in the diff. Never touch `.claudinite/local_packs/` or anything outside `shared/`
     except what a note names.
  3. **Advance the stamp** — `{ "updated": "<full ISO datetime>", "ref": "<verified canon head sha>" }`
     — **in the same commit as steps 1–2's writes**: the stamp gates which notes apply, so it
     must never advance in a commit that lacks any pending note's ops (#329).
  If any part fails **before that commit, write nothing** — the member keeps running its old
  snapshot coherently, tonight's failure goes to the routine's failure log, and the next night
  retries from the same stamp. Also keep the fresh-path wiring converged per [bootstrap.md](../../../bootstrap.md)
  (hook registrations, the `@.claudinite/shared/CLAUDE.md` import, the CI stub copy) — additive
  and in-place fixes only, never clobbering the member's own entries.
- **Pre-flip member** (no stamp) — first consult the live **flip note**
  (`migrations/active_migrations/*vendored-mount-flip*`): if its `flip.repos` names this member
  (or is `'fleet'`), perform the **conversion** by following the note's `steps` verbatim — one
  delivery-aware commit, transactional (any failure writes nothing). Otherwise apply **only**
  the legacy maintenance in bootstrap.md's
  [transition appendix](../../../bootstrap.md#appendix--pre-flip-members-transition-window-retiring):
  refresh the tracked sync hook from the canon, keep the legacy wiring/gitignore/declaration
  backfills converged. **Never convert a member the note doesn't name** — the pilot gate is the
  point; widening it is a reviewed one-line canon change, not this worker's call.
- **Adopt a queued repo** (a repo with an open `Adopt <owner>/<repo>` issue — the census applied
  every eligibility rule) — run the fresh-path bootstrap (which vendors the mount); it's a
  **first** adoption, so **do open** its enrollment issue, noting the owner-in-the-loop parts
  skipped unattended (adoption interview, project classification, cloud env setup) and anything
  the API couldn't do. A queued repo you can't reach stays queued — the issue is the owner's cue
  to grant access; log it and move on.

Then, for a covered member (either shape):

- **Declaration normalization** — a local pack's canonical declaration token is namespaced:
  `local_packs/<name>` ([packs/registry.mjs](../../registry.mjs) `declTokenFor`). Rewrite any **bare**
  local-pack declaration in the member's `.claudinite-checks.json` to that form: a declared id (string
  entry, or an entry object's `id`) without the `local_packs/` prefix whose pack lives in the member's
  own `.claudinite/local_packs/<id>/` gets the prefix; everything else on the entry stays verbatim, and
  a bare id with no such local pack is a canon declaration — leave it alone. Idempotent, and tracked by
  the `local-pack-namespace` baseline migration until the fleet converges.
- **Align** — evaluate the repo against its declared packs' *current* checks (the same engine its Stop
  hook and CI run). Apply a failing check's own `fix` remedy, **never more**; a finding needing
  judgment becomes an issue in the member repo, not an edit.
- **Enrollment issue** — being reached proves enrollment: close a still-open one (title
  `Enroll <PROJECT_NAME> in Claudinite fleet maintenance`, found by title) as `completed`.

**Delivery** — member-side changes go per `maintenance.delivery` in the member's `.claudinite-checks.json`
(always explicit; a missing key is drift — materialize `{ "maintenance": { "delivery": "auto" } }`;
`push`/`pr` are accepted as legacy aliases for `auto`/`review`).
**Both modes land on the stable `claudinite/maintenance` branch and its one PR — never a direct commit
to the default branch** (the same PR the migration apply pass amends): `auto` **arms auto-merge** on that
PR, so GitHub lands it once the member's checks pass, with no human review — that's what keeps the
fleet's nightly maintenance from piling up as review requests; `review` leaves the PR for the owner to
review (never auto-merged); an unrecognized value commits nothing and opens an issue there naming it.
Adoption precedes the flag — a first bootstrap lands via the same PR, auto-merged where the new repo
allows it, else left for the owner. A vendored member's refresh lands as **one `push_files` commit** on
that branch regardless of delivery mode — notes + converge writes + stamp never split. The one thing
that can't ride it: file **deletions** (convergence pruning a file the set dropped, or a note's delete)
— MCP has no multi-file+delete, so they follow immediately as their own `delete_file` commits,
**after** the stamped content commit (#329). Trailing deletes are safe to interrupt: the next night's
unconditional convergence re-deletes any straggler, whereas note ops are stamp-gated and so must always
land with the stamp.

Never touch the home (sheepdog) repo; never adopt without an open adoption issue; never flip a
pre-flip member; never let alignment edit beyond a failing check's own remedy; never merge a delivery
PR by hand (the `auto` lane arms GitHub's auto-merge, which lands it once checks pass — the worker never
clicks merge) or guess a delivery preference. `smarts: medium` — the bootstrap and alignment merge
into existing `CLAUDE.md` / `settings.json` without clobbering, which is judgment.
