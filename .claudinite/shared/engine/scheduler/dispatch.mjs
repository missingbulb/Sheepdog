// The dispatch issue — how a due (task, slot) becomes exactly-once, bounded,
// recoverable agent work (per-project-scheduling DESIGN §4). This module is the
// PURE half: issue identity (title/body/parse) and the create / skip / suppress
// decision over the issues that already exist. A thin scheduler shell does the
// GitHub I/O (search state=all, create, label, comment) and applies the verdict
// — the "should I file this" decision is always code here, never the shell's
// judgment (the same split the fleet planner uses).
//
// All behavior-defining content (model, outcome, worker) is read from the
// tracked task files, never from the issue — the body only points at the task
// file and carries the precondition's binding Context (DESIGN §4).

export const READY_LABEL = 'ready-for-agent';
export const NEEDS_HUMAN_LABEL = 'needs-human';

export const DISPATCH_PREFIX = '[claudinite-task]';

export const dispatchTitle = ({ pack, task, slotId }) => `${DISPATCH_PREFIX} ${pack}/${task} ${slotId}`;

export const dispatchTaskKey = ({ pack, task }) => `${DISPATCH_PREFIX} ${pack}/${task}`;

const DISPATCH_TITLE_RE = /^\[claudinite-task\]\s+([^/\s]+)\/([^/\s]+)\s+(\S+)$/;

export function parseDispatchTitle(title) {
  const m = DISPATCH_TITLE_RE.exec(String(title ?? '').trim());
  return m ? { pack: m[1], task: m[2], slotId: m[3] } : null;
}

export const isDispatchTitle = (title) => parseDispatchTitle(title) !== null;

export function dispatchBody({ taskPath, pack, task, slotId, context = [] }) {
  const lines = [taskPath, ''];
  if (context.length) {
    lines.push(
      `Execute the Claudinite task above (pack \`${pack}\`, task \`${task}\`, slot \`${slotId}\`).`,
      'The Context section below is binding scope — do not re-decide it.',
      '',
      '### Context',
    );
    for (const c of context) lines.push(`- ${c}`);
  } else {
    lines.push(`Execute the Claudinite task above (pack \`${pack}\`, task \`${task}\`, slot \`${slotId}\`).`);
  }
  return lines.join('\n') + '\n';
}

export function planDispatch({ existing = [], pack, task, slotId }) {
  const title = dispatchTitle({ pack, task, slotId });
  const keyPrefix = `${dispatchTaskKey({ pack, task })} `;
  const family = existing.filter((i) => `${(i.title ?? '').trim()} `.startsWith(keyPrefix));

  if (family.some((i) => (i.title ?? '').trim() === title)) {
    return { action: 'skip', reason: `dispatch issue for slot ${slotId} already exists (exactly-once)` };
  }
  const open = family.find((i) => i.state === 'open');
  if (open) {
    return { action: 'suppress', openIssue: open.number, reason: `an open dispatch issue (#${open.number}) already covers ${pack}/${task}` };
  }
  return { action: 'create', title, label: READY_LABEL, reason: `no dispatch issue yet for ${pack}/${task} slot ${slotId}` };
}

const SLOT_PERIOD_MS = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 31 * 86400e3 };

function slotPeriodMs(slotId) {
  return SLOT_PERIOD_MS[String(slotId ?? '')[0]] ?? null;
}

export function staleDispatchIssues(openIssues = [], now, { factor = 2 } = {}) {
  const nowMs = new Date(now).getTime();
  return openIssues.filter((issue) => {
    const parsed = parseDispatchTitle(issue.title);
    if (!parsed) return false;
    const period = slotPeriodMs(parsed.slotId);
    if (period === null) return false;
    return nowMs - new Date(issue.created_at).getTime() > factor * period;
  });
}

export function staleEscalationComment(issue) {
  const parsed = parseDispatchTitle(issue.title);
  const which = parsed ? `${parsed.pack}/${parsed.task} (slot ${parsed.slotId})` : 'this task';
  return `This dispatch issue for ${which} has stayed open past ~2 of its scheduling periods without being executed — `
    + `no executor session drained it. Labeling \`${NEEDS_HUMAN_LABEL}\` for triage.`;
}
