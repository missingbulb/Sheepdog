import { finding } from '../../engine/checks/helpers/findings.mjs';
import { FREQUENCIES } from '../../engine/scheduler/slots.mjs';
import { MODEL_FAMILIES } from '../../engine/scheduler/model-map.mjs';
import { OUTCOMES, SIGNAL_NAMES } from '../../engine/scheduler/task-contract.mjs';

// Every scheduler task is a `tasks/<name>/task.mjs` whose default export carries
// the full declaration contract (per-project-scheduling DESIGN §1) with legal
// enum values. This asserts that shape statically at author time — the executor
// and scheduler validate the same contract at run time (task-contract.mjs), so
// an illegal frequency/model/outcome, or a missing field, is caught here first.
//
// RELEVANCE FIRST (engine/checks/README.md): gated on a `tasks/<name>/task.mjs`
// existing, so the check is inert on any repo without tasks. Static text over
// the self-contained module (task.mjs imports nothing), keyed off the canonical
// enum lists so the legal values never drift from the runtime validator.
const TASK_MJS = /(^|\/)tasks\/[^/]+\/task\.mjs$/;

// The value of a top-level `key: 'value'` string field, or null if absent.
const strField = (text, key) => {
  const m = new RegExp(`\\b${key}:\\s*['"]([^'"]+)['"]`).exec(text);
  return m ? m[1] : null;
};

const rule = {
  id: 'task-declaration-shape',
  severity: 'blocking',
  description: 'A tasks/<name>/task.mjs default-exports the full task contract (id, frequency, signals, model, outcome, worker, precondition) with legal enum values',
  doc: 'packs/basics/scheduled-tasks.md',
  why: 'the scheduler and executor read model/outcome/frequency from this file, not the dispatch issue — an illegal or missing value means a task never fires, fires wrong, or writes past its ceiling',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => TASK_MJS.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const flag = (what, fix) => out.push(finding(rule, { file, what, fix }));

      if (!/export\s+default\s*\{/.test(text)) {
        flag('does not default-export a declaration object', 'export default { id, frequency, signals, model, outcome, worker, precondition }');
        continue;
      }
      const enumField = (key, legal) => {
        const v = strField(text, key);
        if (v === null) flag(`declares no "${key}"`, `add "${key}": one of ${legal.join(', ')}`);
        else if (!legal.includes(v)) flag(`"${key}" is "${v}", not a legal value`, `use one of: ${legal.join(', ')}`);
      };
      enumField('frequency', FREQUENCIES);
      enumField('model', MODEL_FAMILIES);
      enumField('outcome', OUTCOMES);

      if (!/\bid:\s*['"]/.test(text)) flag('declares no string "id"', 'add "id": the task name (matching its directory)');
      if (!/\bworker:\s*['"]/.test(text)) flag('declares no string "worker"', 'add "worker": the worker file beside task.mjs (e.g. "task.md")');
      if (!/\bsignals:\s*\[/.test(text)) {
        flag('declares no "signals" array', `add "signals": an array of ${SIGNAL_NAMES.join(', ')}`);
      }
      if (!/\bprecondition\s*[:(]/.test(text)) {
        flag('declares no "precondition" function', 'add a precondition(signals, config) that returns { run, reason, context? }');
      }
    }
    return out;
  },
};

export default rule;
