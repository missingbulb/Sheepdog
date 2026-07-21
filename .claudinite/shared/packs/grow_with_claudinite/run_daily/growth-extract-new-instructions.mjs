// grow_with_claudinite run_daily task: growth-extract-new-instructions (the growth
// lifecycle's capture stage). Captures the last 24h of bugs/PRs/commits into the
// project's own docs. Worker: the co-located extract.md. An ordinary independent
// unit — no barrier; the central home-only promote stage picks up whatever is
// merged here by its next run.
//
// Trigger: the project changed in the window (commits / merged PRs). No distinct full
// mode — extract's window is a fixed lookback, and a quiet project has nothing to
// extract even on a full-sweep night — so full_sweep_supported is false (fullSweep is
// a no-op for it: the engine masks it, so the gate never sees fullSweep true here).

export default {
  id: 'growth-extract-new-instructions',
  worker: 'packs/grow_with_claudinite/extract.md',
  full_sweep_supported: false,
  smarts: 'high', // generalizing/curating lessons is the heaviest judgment

  async gate(repo, signals) {
    // substantiveChange, not projectChanged: a bot bump / [skip ci] / nightly
    // baselining commit advancing main is not a lesson to extract (see signals.mjs).
    if (signals.substantiveChange) {
      return { run: true, targets: {}, reason: 'project changed substantively in the window' };
    }
    return { run: false };
  },
};
