// grow_with_claudinite run_daily task: growth-dedup-local-instructions (the growth
// lifecycle's pruning stage). Prunes local items the canon now covers, keeping items
// the canon states too generally. Worker: the co-located dedup.md. An ordinary
// independent unit — no barrier; it prunes against whatever canon the member
// currently mounts (merged main), so a just-opened promote PR never counts.
//
// Precondition: the member must actually track local packs. A repo with no
// `.claudinite/local_packs/` has nothing to prune, so the gate self-skips it entirely
// (`hasLocalPacks` — one cheap planner read) rather than booting a subagent to discover
// the empty surface.
//
// Triggers (given local packs): a canon change the member CARES about — a pack it
// declares moved, or a cross-cutting canon area (checks/skills/mount/…) moved
// (`relevantCanonChanged`, not the coarse global `canonChanged`: a change to a pack the
// repo doesn't mount can't newly cover its local items) — or the project's own docs
// changed. Full mode (weekly): re-check every local item against the canon regardless —
// so full_sweep_supported is true.

export default {
  id: 'growth-dedup-local-instructions',
  worker: 'packs/grow_with_claudinite/dedup.md',
  full_sweep_supported: true,
  smarts: 'high', // deciding a local item is truly redundant is a judgment call

  async gate(repo, signals) {
    if (!signals.hasLocalPacks) return { run: false }; // nothing to prune
    if (signals.fullSweep) {
      return { run: true, targets: {}, reason: 'weekly full dedup vs canon' };
    }
    if (signals.relevantCanonChanged) {
      return { run: true, targets: {}, reason: 'a declared pack changed in canon — local items may now be covered' };
    }
    // substantiveChange, not projectChanged: a housekeeping main move (bot bump /
    // baselining commit) changes no local lesson worth re-deduping (see signals.mjs).
    if (signals.substantiveChange) {
      return { run: true, targets: {}, reason: 'project docs changed substantively' };
    }
    return { run: false };
  },
};
