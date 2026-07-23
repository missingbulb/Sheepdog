// grow_with_claudinite task: growth-dedup — the growth lifecycle's PRUNING stage
// (per-project-scheduling DESIGN §6). Prunes local-pack items the canon now
// covers, keeping items the canon states too generally; opens a PR against the
// default branch for the owner to approve. Worker: task.md.
//
// The old fleet's `relevantCanonChanged` becomes the `sharedMount` signal — a
// declared pack's vendored files moving is the local echo of "the canon this repo
// mounts changed" — and the weekly re-check crutch retires: a quiet repo with no
// local packs skips.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'growth-dedup',
  frequency: 'daily+1h',           // the 05:00 slot — prunes against the merged/mounted canon, after promote (DESIGN §2)
  signals: ['localPacks', 'sharedMount', 'commits'],
  model: 'opus',                   // proving the canon genuinely covers a local item — and telling coverage from "stated too generally" — is a judgment call
  outcome: 'open-pr',              // a wrongful prune deletes a real local lesson, so this keeps a HUMAN approval gate (never auto-merge)
  worker: 'task.md',

  // Gate: the repo must actually track local packs (no local packs → nothing to
  // prune, self-skip). Given local packs, run when the mounted canon this repo
  // CARES about moved — a declared pack's vendored files changed (`sharedMount`),
  // which can newly cover a local item — or the repo's own local packs changed in
  // the window (a fresh local item to re-check against the canon). A quiet repo
  // with local packs but no relevant movement skips.
  precondition(signals) {
    const local = signals.localPacks ?? {};
    // `present` is null when the scheduler couldn't determine it; treat only an
    // explicit false as "definitely no local packs to prune".
    if (local.present === false) {
      return { run: false, reason: 'no local packs — nothing to prune' };
    }
    const changedPacks = signals.sharedMount?.changedPacks ?? [];
    const canonMoved = changedPacks.length > 0;
    const localChanged = local.changedInWindow === true;

    if (canonMoved) {
      return { run: true, reason: `declared pack(s) changed in the mounted canon: ${changedPacks.join(', ')} — local items may now be covered`, context: [`Re-check local items against these newly-changed canon packs: ${changedPacks.join(', ')}.`] };
    }
    if (localChanged) {
      return { run: true, reason: 'local packs changed in the window — re-check the fresh items against the mounted canon' };
    }
    return { run: false, reason: 'local packs present but no relevant canon or local movement in the window' };
  },
};
