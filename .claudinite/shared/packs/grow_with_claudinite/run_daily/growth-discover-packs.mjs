// grow_with_claudinite run_daily task: growth-discover-packs — the pack-discovery
// pipeline, a regular member-scoped unit (the central promote stage is the
// home-only one). The planner picks it up per member on that member's weekly full
// sweep; the orchestrator dispatches it like any unit. The worker runs centrally
// (home session, fleet token): for the member it's handed it manifests the stack,
// suggests a pack for each unhomed technology, populates it from real usage, and
// opens one canon PR per pack. Worker: the co-located discover-packs.md.
//
// Weekly only — a repo's stack is slow-moving, so full_sweep_supported is true and the
// gate fires solely on fullSweep (the engine masks fullSweep for tasks that don't declare
// it, so the gate only ever sees it true here).

export default {
  id: 'growth-discover-packs',
  worker: 'packs/grow_with_claudinite/discover-packs.md',
  full_sweep_supported: true,
  smarts: 'high', // authoring a pack — distilling rules, writing checks + fixtures — is heavy judgment

  async gate(repo, signals) {
    if (signals.fullSweep) {
      return { run: true, targets: {}, reason: 'weekly pack discovery' };
    }
    return { run: false };
  },
};
