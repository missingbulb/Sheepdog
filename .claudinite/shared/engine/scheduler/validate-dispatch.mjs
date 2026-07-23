// Executor-side deterministic validation of a dispatch issue, BEFORE any model
// judgment (per-project-scheduling DESIGN §5.2). Given the issue body, it asserts
// in code that the first line is a legal task path, the task file exists at HEAD,
// its pack is declared, and its `task.mjs` sibling parses to a well-formed
// declaration — then resolves the model and outcome ceiling the executor will
// enforce. An invalid dispatch is rejected (the executor de-labels it and
// converges it to needs-human), so a forged or mangled issue never runs.
//
// Pure over injected capabilities so it unit-tests without a repo or GitHub. The
// thin `node validate-dispatch.mjs <n>` CLI the executor invokes (fetch the
// issue, wire `exists`/`isPackDeclared`/`loadTask` to the checkout) lands with
// the executor shell.

import { validateTaskDeclaration } from './task-contract.mjs';
import { resolveModel } from './model-map.mjs';

export const DISPATCH_PATH_RE = /^\.claudinite\/(shared|local)\/packs\/([^/]+)\/tasks\/([^/]+)\/task\.md$/;

export const dispatchFirstLine = (body) => String(body ?? '').split('\n')[0].trim();

const reject = (reason) => ({ ok: false, reason });

export function validateDispatchBody(body, { exists, isPackDeclared, loadTask }) {
  const firstLine = dispatchFirstLine(body);
  const m = DISPATCH_PATH_RE.exec(firstLine);
  if (!m) return reject(`first line "${firstLine}" is not a valid task path (${DISPATCH_PATH_RE})`);

  const [, , pack, task] = m;
  const taskPath = firstLine;
  const mjsPath = taskPath.replace(/task\.md$/, 'task.mjs');

  if (!exists(taskPath)) return reject(`task file ${taskPath} does not exist at HEAD`);
  if (!exists(mjsPath)) return reject(`the task.mjs sibling ${mjsPath} is missing`);
  if (!isPackDeclared(pack)) return reject(`pack "${pack}" is not declared in .claudinite-checks.json`);

  let decl;
  try {
    decl = loadTask(mjsPath);
  } catch (e) {
    return reject(`${mjsPath} did not parse: ${e.message}`);
  }
  const problems = validateTaskDeclaration(decl);
  if (problems.length) return reject(`${mjsPath} is not a valid task declaration: ${problems.map((p) => p.what).join('; ')}`);

  return {
    ok: true,
    pack,
    task,
    taskPath,
    model: decl.model,
    resolvedModel: resolveModel(decl.model),
    outcome: decl.outcome,
  };
}
