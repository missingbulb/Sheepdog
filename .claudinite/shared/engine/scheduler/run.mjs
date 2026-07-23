// The scheduler entrypoint's orchestration core (per-project-scheduling DESIGN
// §3). The vendored hourly Action runs this: decide due slots from the run
// ledger, discover active tasks, collect only the signals the due tasks declare,
// run each precondition, and either dispatch agent work as a `ready-for-agent`
// issue or (for `model: none`) run the worker inline.
//
// This module is the DECISION core, kept injectable so it tests with fakes: the
// GitHub I/O (the Actions run-ledger read for `lastSuccess`, the signal
// collectors, the issue search/create) is supplied by the thin CLI shell around
// `planRun`. The "should this run" verdict is always code here — never the
// shell's judgment (the same split the fleet planner uses).

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dueSlots } from './slots.mjs';
import { planDispatch, dispatchTitle, dispatchBody, DISPATCH_PREFIX, READY_LABEL } from './dispatch.mjs';
import { isAgentless } from './model-map.mjs';

export function computeDueTaskSlots(tasks, schedule, now, lastSuccess) {
  const frequencies = [...new Set(tasks.map((t) => t.decl.frequency))];
  const due = new Map(dueSlots(frequencies, schedule, now, lastSuccess).map((d) => [d.frequency, d]));
  const out = [];
  for (const task of tasks) {
    const slot = due.get(task.decl.frequency);
    if (slot) out.push({ task, slotId: slot.slotId, slotTime: slot.slotTime });
  }
  return out;
}

export function signalsUnion(dueTaskSlots) {
  const names = new Set();
  for (const { task } of dueTaskSlots) for (const name of task.decl.signals) names.add(name);
  return [...names];
}

const FREQUENCY_MS = {
  hourly: 3600e3, 'daily-2h': 86400e3, 'daily-1h': 86400e3, daily: 86400e3,
  'daily+1h': 86400e3, weekly: 7 * 86400e3, monthly: 31 * 86400e3,
};
export function windowStart(dueTaskSlots, now) {
  const widest = Math.max(0, ...dueTaskSlots.map(({ task }) => FREQUENCY_MS[task.decl.frequency] ?? 86400e3));
  return new Date(new Date(now).getTime() - widest - 3600e3).toISOString();
}

export function runPrecondition(task, signals, packConfig) {
  try {
    const v = task.decl.precondition(signals, packConfig) ?? {};
    return {
      run: v.run === true,
      reason: v.reason ?? '',
      context: Array.isArray(v.context) ? v.context : [],
    };
  } catch (e) {
    return { run: false, reason: `precondition threw: ${e.message}`, context: [], error: e.message };
  }
}

export function renderSummary(evaluations) {
  return evaluations.map((e) => {
    const verb = !e.run ? 'skip' : e.inline ? 'run-inline' : e.dispatch?.action ?? 'run';
    return `- ${e.pack}/${e.task} [${e.slotId}] ${verb} — ${e.reason || e.dispatch?.reason || ''}`.trimEnd();
  }).join('\n');
}

export async function planRun({
  tasks, schedule, now, lastSuccess,
  collectSignals, packConfigFor = () => ({}), existingIssuesFor = async () => [],
}) {
  const dueList = computeDueTaskSlots(tasks, schedule, now, lastSuccess);
  const signals = await collectSignals(signalsUnion(dueList));

  const evaluations = [];
  for (const { task, slotId } of dueList) {
    const pre = runPrecondition(task, signals, packConfigFor(task.pack));
    const rec = {
      pack: task.pack, task: task.id, slotId,
      model: task.decl.model, outcome: task.decl.outcome,
      run: pre.run, reason: pre.reason, context: pre.context,
    };
    if (pre.error) rec.error = pre.error;
    if (pre.run) {
      if (isAgentless(task.decl.model)) {
        rec.inline = true;
      } else {
        const existing = await existingIssuesFor(task.pack, task.id);
        rec.dispatch = planDispatch({ existing, pack: task.pack, task: task.id, slotId });
      }
    }
    evaluations.push(rec);
  }
  return { evaluations };
}

async function existingIssuesViaSearch(gh, repo, pack, task) {
  const q = encodeURIComponent(`repo:${repo} in:title "${DISPATCH_PREFIX} ${pack}/${task}"`);
  const { status, json } = await gh(`/search/issues?q=${q}&per_page=100`);
  if (status !== 200 || !Array.isArray(json?.items)) return [];
  const prefix = `${DISPATCH_PREFIX} ${pack}/${task} `;
  return json.items
    .filter((i) => `${(i.title ?? '').trim()} `.startsWith(prefix))
    .map((i) => ({ number: i.number, title: i.title, state: i.state }));
}

async function main() {
  const { makeGh, lastSuccessTime, actionRepoContext } = await import('./signals/gh.mjs');
  const { collectSignals } = await import('./signals/index.mjs');
  const { discoverTasks } = await import('./discover.mjs');
  const { loadConfig } = await import('../checks/helpers/repo-context.mjs');

  const root = process.cwd();
  const { repo, defaultBranch } = actionRepoContext();
  if (!repo) { console.error('GITHUB_REPOSITORY not set — not in an Actions context'); process.exit(1); }
  const gh = makeGh();
  const config = loadConfig(root);

  const { tasks, errors } = await discoverTasks(root, config);
  for (const e of errors) console.log(`! ${e.what}`);

  const now = new Date();
  const lastSuccess = await lastSuccessTime(gh, repo);
  const schedule = config.schedule;

  const due = computeDueTaskSlots(tasks, schedule, now, lastSuccess);
  const sinceIso = windowStart(due, now);
  const ctx = {
    repo, defaultBranch, now: now.toISOString(), sinceIso, config,
    activePacks: config.packs,
  };
  const packConfigFor = (packId) => config.packConfig?.[packId] ?? {};

  const { evaluations } = await planRun({
    tasks, schedule, now, lastSuccess,
    collectSignals: (names) => collectSignals(gh, ctx, names),
    packConfigFor,
    existingIssuesFor: (pack, task) => existingIssuesViaSearch(gh, repo, pack, task),
  });

  for (const rec of evaluations) {
    if (!rec.run) continue;
    const taskObj = tasks.find((t) => t.pack === rec.pack && t.id === rec.task);
    if (rec.inline) {
      try {
        const workerUrl = pathToFileURL(join(taskObj.taskDir, taskObj.decl.worker)).href;
        const worker = (await import(workerUrl)).default;
        if (typeof worker === 'function') await worker({ gh, repo, ctx, slotId: rec.slotId });
      } catch (e) { console.log(`! inline worker ${rec.pack}/${rec.task} failed: ${e.message}`); }
      continue;
    }
    if (rec.dispatch?.action === 'create') {
      const title = dispatchTitle({ pack: rec.pack, task: rec.task, slotId: rec.slotId });
      const body = dispatchBody({ taskPath: taskObj.taskPath, pack: rec.pack, task: rec.task, slotId: rec.slotId, context: rec.context });
      const res = await gh(`/repos/${repo}/issues`, { method: 'POST', body: { title, body, labels: [READY_LABEL] } });
      if (res.status >= 300) console.log(`! failed to file dispatch issue for ${rec.pack}/${rec.task}: ${res.status}`);
    }
  }

  console.log('## Claudinite scheduler\n');
  console.log(renderSummary(evaluations) || '- no tasks due');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
