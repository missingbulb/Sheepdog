import barrier from './check.mjs';
import { contributedBarrierRules } from './contributed.mjs';

// The barriers pack — enforce a directed folder-access graph. A declared pack
// (no fingerprint: wanting structural segregation is a project's own call, and
// another pack can pull it in via `requires`), it ships one config-driven check
// reading the repo's graph from .claudinite-checks.json `packConfig.barriers`,
// and interprets the fixed barriers other active packs CONTRIBUTE as manifest
// data (contributes: { barriers: [...] } — contributed.mjs builds each into a
// first-class rule). Composition is declaration + configuration, never a code
// import (pack-independence) — the mechanism this pack exists to provide. No
// prose: the finding is the instruction, and the full guide is the README.
//
// Adopting barriers without a graph is a silent no-op, so adoption asks what
// the barriers are FOR (the adoption skill's interview machinery) — the guided on-ramp beats both
// running empty and guessing separations from existing state.
export default {
  id: 'barriers',
  detect: null,
  marker: null,
  prose: null,
  questions: [{
    id: 'goals',
    prompt: 'What should these barriers accomplish — which folders must never reference which (imports, paths, docs included), and what architectural boundary does each separation protect?',
    distill: 'derive the directed edge list into this entry\'s config as { "rules": [{ "from": "<dir>", "to": "<dir>" }] }; if no separation is wanted yet, record that as the answer and leave config unset',
  }],
  rules: [barrier],
  // The runner's generic seam: this pack interprets the barrier contributions
  // of every ACTIVE pack (engine/checks/check_the_world.mjs hands the list over).
  contributedRules: (activePacks) => contributedBarrierRules(activePacks),
};
