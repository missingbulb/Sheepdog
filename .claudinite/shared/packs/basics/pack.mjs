import commentClassification from './comment-classification.mjs';
import referenceIntegrity from './reference-integrity.mjs';
import markdownLinkLabels from './markdown-link-labels.mjs';
import taskLifecycle from './task-lifecycle.mjs';
import warningSuppression from './warning-suppression.mjs';
import filePlacement from './file-placement.mjs';
import squashMergeHistory from './squash-merge-history.mjs';
import claudeMdLength from './claude-md-length.mjs';
import generatedMergeDriver from './generated-merge-driver.mjs';
import sharedConstants from './shared-constants.mjs';
import catalogCompleteness from './catalog-completeness.mjs';
import claudiniteIsolation from './claudinite-isolation.mjs';
import schedulerWorkflowShape from './scheduler-workflow-shape.mjs';
import taskDeclarationShape from './task-declaration-shape.mjs';
import baselining from './run_daily/baselining.mjs';

// The baseline pack: working discipline, the task lifecycle, and the core
// checks. Declared explicitly like every other pack — no pack is active by
// default. Bootstrap's --init seeds the declaration and the nightly baselining
// backfills it into existing consumers; never fingerprinted (the declaration is
// authoritative — dropping it is a deliberate choice).
export default {
  id: 'basics',
  detect: null,
  marker: null,
  seededByDefault: true,
  prose: 'RULES.md',
  // The consumer-isolation wall rides the barriers mechanism: basics requires
  // the barriers pack and CONTRIBUTES the fixed barrier as manifest data
  // (claudinite-isolation.mjs — pure data, no cross-pack import;
  // pack-independence). git-github carries the git/GitHub side of the task
  // lifecycle (#385). Universal because basics is declared everywhere; the
  // requires closure materializes both declarations alongside it.
  requires: ['barriers', 'git-github'],
  contributes: { barriers: [claudiniteIsolation] },
  rules: [
    commentClassification,
    referenceIntegrity,
    markdownLinkLabels,
    taskLifecycle,
    warningSuppression,
    filePlacement,
    squashMergeHistory,
    claudeMdLength,
    generatedMergeDriver,
    sharedConstants,
    catalogCompleteness,
    // The per-project scheduling conformance guards (scheduled-tasks.md):
    // scheduling is baseline Claudinite discipline — the scheduler workflow and
    // the task-declaration contract are guarded wherever basics is declared
    // (everywhere). Both rules are relevance-first: inert until the repo carries
    // the workflow / a tasks/<name>/task.mjs of its own.
    schedulerWorkflowShape,
    taskDeclarationShape,
  ],
  // The baseline skills — general engineering practice every project's work
  // can call for, whatever its technology — are bundled under skills/ in this
  // pack's own tree and mounted wherever basics is declared (which --init
  // seeds everywhere). The directory listing IS the manifest; when one stops
  // being a baseline activity, move its directory to the pack whose projects
  // need it (#385 moved the git/GitHub and Claudinite-lifecycle skills out).
  // The baseline daily task every member runs: baselining (re-run the idempotent
  // bootstrap + check-alignment). Being in basics — declared everywhere — makes it
  // fleet-universal without a fleet-core category.
  run_daily: [baselining],
};
