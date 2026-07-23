// grow_with_claudinite task: conversation-extract — the conversation-side sibling
// of growth-extract (per-project-scheduling DESIGN §6). Mines the repo's captured
// conversation logs (the orphan `conversation-logs` branch) for durable lessons,
// posts the dialogue behind each extracted rule on the issue it was worked under,
// and prunes logs past the entry's retention. Worker: task.md.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'conversation-extract',
  frequency: 'daily-1h',           // the 03:00 slot, alongside growth-extract (DESIGN §2)
  signals: ['commits', 'conversationLogs'],
  model: 'opus',                   // deciding what clears the lesson bar is the heaviest judgment, and its PR auto-merges without a human gate
  outcome: 'merged-pr',            // lessons ride an auto-merging PR; the retention prune is a push to the non-default logs branch (outside the taxonomy)
  worker: 'task.md',

  // Two independent reasons to run, so the age-based prune fires on quiet repos
  // too (the old weekly-full crutch retires — a log ages out on wall time, not on
  // the repo changing, DESIGN §6):
  //   (a) a substantive merge — a fresh capture now sits on the logs branch;
  //   (b) the logs branch exists AND retention is configured — there may be aged
  //       logs to give a final hindsight pass and prune, regardless of activity.
  precondition(signals) {
    const substantive = signals.commits?.substantiveChange === true;
    const logs = signals.conversationLogs ?? {};
    const canPrune = logs.present === true && typeof logs.retentionDays === 'number';

    if (substantive) {
      return { run: true, reason: 'substantive merge — extract any freshly captured conversation logs (+ retention prune)' };
    }
    if (canPrune) {
      return { run: true, reason: `logs branch present, retention ${logs.retentionDays}d — run the age-based retention prune` };
    }
    return { run: false, reason: logs.present ? 'no substantive merge and retention unset — nothing to prune' : 'no fresh captures and no logs branch' };
  },
};
