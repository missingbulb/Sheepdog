import { finding } from '../../engine/checks/helpers/findings.mjs';

// The vendored per-repo scheduler workflow (per-project-scheduling DESIGN §3) is
// a shape-enforced thin shim: hourly cron on a repo-hashed minute constrained to
// :10–:50, a concurrency group, a workflow_dispatch trigger, and a call into the
// vendored engine entry. This asserts that shape wherever the file exists.
//
// RELEVANCE FIRST (engine/checks/README.md): a skill/pack check runs on every
// repo, so gate on the artifact — here, the scheduler workflow file existing.
// Inert until a repo vendors it (its cutover); a repo without one is untouched.
const SCHEDULER_WORKFLOW = '.github/workflows/claudinite-scheduler.yml';

const rule = {
  id: 'scheduler-workflow-shape',
  severity: 'blocking',
  description: 'The vendored claudinite-scheduler.yml is a thin shim: hourly :10–:50 cron, concurrency, workflow_dispatch, calls the engine',
  doc: 'packs/basics/scheduled-tasks.md',
  why: 'the scheduler is the repo\'s only cron and its slot math anchors on the hour — a cron off the :10–:50 band, or a missing concurrency/dispatch guard, silently breaks staggering, double-run safety, or manual runs',

  run(ctx) {
    if (!ctx.files.includes(SCHEDULER_WORKFLOW)) return [];
    const text = ctx.read(SCHEDULER_WORKFLOW);
    if (text === null) return [];
    const out = [];
    const flag = (what, fix) => out.push(finding(rule, { file: SCHEDULER_WORKFLOW, what, fix }));

    const crons = [...text.matchAll(/cron:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => m[1].trim());
    if (crons.length !== 1) {
      flag(`declares ${crons.length} cron schedules, expected exactly one`, 'keep a single hourly cron — the scheduler is the repo\'s only cron');
    }
    for (const cron of crons) {
      const parts = cron.split(/\s+/);
      const minute = Number(parts[0]);
      const hourly = parts.length === 5 && parts.slice(1).join(' ') === '* * * *';
      if (!hourly) {
        flag(`cron "${cron}" is not an hourly schedule`, 'use "<minute> * * * *" — hourly, so the run-ledger due-slot math catches every slot');
      }
      if (!(Number.isInteger(minute) && minute >= 10 && minute <= 50)) {
        flag(`cron minute "${parts[0]}" is not a single integer in :10–:50`, 'set a fixed minute between 10 and 50 (bootstrap assigns the repo-hashed value) — off-band crons collide with GitHub\'s :00 stampede or the hour boundary the slot math anchors on');
      }
    }
    if (!/^\s*workflow_dispatch:/m.test(text)) {
      flag('has no workflow_dispatch trigger', 'add workflow_dispatch: so the scheduler can be run manually');
    }
    if (!/^\s*concurrency:/m.test(text)) {
      flag('has no concurrency group', 'add a concurrency: group so overlapping runs serialize (double-run safety)');
    }
    if (!/engine\/scheduler\/run\.mjs/.test(text)) {
      flag('does not run the vendored engine entry', 'the job must run node .claudinite/shared/engine/scheduler/run.mjs — all logic lives in the vendored engine, not the workflow');
    }
    return out;
  },
};

export default rule;
