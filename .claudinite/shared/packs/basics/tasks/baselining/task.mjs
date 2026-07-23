// basics task: baselining — the per-repo SELF-REFRESH (per-project-scheduling
// DESIGN §6, decision §11.7). Under the old fleet planner this was one leg of a
// central pass over every member; here every repo baselines ITSELF from its own
// scheduler, converging its own `.claudinite/shared/` mount to the current canon
// head, applying the migration notes that landed since its stamp, and advancing
// the stamp — one transactional commit on the `claudinite/maintenance` PR
// (worker: task.md). No cross-repo reach: the read-only canon checkout the
// worker vendors from already rides in the executor session's sources (DESIGN §5).
//
// Self-contained (imports nothing) so the scheduler, executor, and a human all
// load it standalone — the whole contract lives in this default export.

export default {
  id: 'baselining',
  frequency: 'daily-2h',           // the 02:00 slot — a repo's mount is converged before anything reads it (DESIGN §2)
  signals: ['stamp', 'sharedMount'],
  model: 'sonnet',                 // the bootstrap/alignment merges into settings.json without clobbering — judgment
  outcome: 'merged-pr',            // lands on the maintenance PR; arms auto-merge where member config allows
  worker: 'task.md',

  // Run when this repo's vendored mount is behind the canon, or a declared pack's
  // vendored files moved. PURE over the collected signals — no probes here; the
  // worker does the converge/apply/stamp work.
  precondition(signals) {
    const stamp = signals.stamp ?? {};
    const changed = signals.sharedMount?.changedPacks ?? [];

    // No stamp → no vendored mount to refresh (the canon's own repo, or a
    // pre-adoption repo): baselining self-skips, exactly as the old fleet pass
    // skipped home. `ref` null means the same — nothing to converge against.
    if (!stamp.ref && stamp.ageDays === null) {
      return { run: false, reason: 'no vendored mount (no stamp) — nothing to self-refresh' };
    }

    // Primary trigger: the stamp is behind the canon head. `canonHead` is only
    // populated when the Action could read the canon; when it is null we cannot
    // diff, so fall back to stamp AGE — a mount that hasn't refreshed in over a
    // day is due regardless (DESIGN §6, §3.3: "stamp-age fallback when the canon
    // isn't readable from the Action").
    const behindCanon = stamp.canonHead != null && stamp.canonHead !== stamp.ref;
    const staleByAge = stamp.canonHead == null && typeof stamp.ageDays === 'number' && stamp.ageDays > 1;

    // A declared pack's vendored files changed in the window (a member-side edit
    // to the read-only mount, or an already-landed refresh commit) — converge it
    // back to the canon snapshot so drift never accumulates.
    const mountMoved = changed.length > 0;

    if (behindCanon) {
      return { run: true, reason: `mount at ${String(stamp.ref).slice(0, 7)} is behind canon head ${String(stamp.canonHead).slice(0, 7)}`, context: [`Converge \`.claudinite/shared/\` to canon head ${stamp.canonHead} and apply any migration notes dated on/after the stamp (${stamp.updated}).`] };
    }
    if (staleByAge) {
      return { run: true, reason: `canon head unreadable — stamp is ${stamp.ageDays.toFixed(1)}d old (age fallback)`, context: [`Canon head was not readable from the scheduler; refresh from the canon checkout in session and apply notes dated on/after the stamp (${stamp.updated}).`] };
    }
    if (mountMoved) {
      return { run: true, reason: `vendored files changed for declared pack(s): ${changed.join(', ')}`, context: [`Re-converge these packs' vendored files to the canon snapshot: ${changed.join(', ')}.`] };
    }
    return { run: false, reason: 'mount is at canon head and no vendored files moved' };
  },
};
