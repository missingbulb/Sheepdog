// Task discovery for the scheduler (per-project-scheduling DESIGN §3.2). One
// uniform scan of every ACTIVE pack's `tasks/<name>/task.mjs`, activation-gated
// by the repo's `packs` declaration exactly like checks and skills. Reuses the
// pack registry so the same scan works across all three layouts without knowing
// any of them: canon packs at `packs/`, a consumer's vendored canon at
// `.claudinite/shared/packs/`, and local packs at `.claudinite/local/packs/`
// (each pack carries its own resolved `dir`).
//
// Frequency filtering is deliberately NOT done here — discover returns every
// active, well-formed task; the run entrypoint intersects them with the due
// slots (slots.mjs). Keeping the two apart keeps each pure and separately
// testable. A task whose task.mjs fails to import or violates the declaration
// contract is dropped into `errors` (fail-soft, per-task), never sinking the
// scan.

import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPacks, isActive } from '../pack_loader/pack-registry.mjs';
import { validateTaskDeclaration } from './task-contract.mjs';

// Discover every task the repo's active packs contribute. Returns
// `{ tasks, errors }` where each task is
// `{ pack, id, taskDir, taskPath, decl }` — `taskPath` is the repo-relative
// path to the worker file's directory's task.md (the dispatch issue's first
// line), `decl` the validated declaration.
export async function discoverTasks(root, config) {
  const errors = [];
  const packs = await loadPacks({ localRoot: root });
  const active = packs.filter((p) => isActive(p, config));

  const tasks = [];
  for (const pack of active) {
    const tasksRoot = join(pack.dir, 'tasks');
    if (!existsSync(tasksRoot)) continue;
    let names;
    try {
      names = readdirSync(tasksRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch (e) {
      errors.push({ pack: pack.id, what: `${pack.id}'s tasks/ is not a readable directory: ${e.message}`, fix: `make ${relative(root, tasksRoot)} a directory (or remove it)` });
      continue;
    }
    for (const name of names) {
      const taskDir = join(tasksRoot, name);
      const mjs = join(taskDir, 'task.mjs');
      if (!existsSync(mjs)) continue;
      let decl;
      try {
        decl = (await import(pathToFileURL(mjs).href)).default;
      } catch (e) {
        errors.push({ pack: pack.id, task: name, what: `${relative(root, mjs)} failed to import: ${e.message}`, fix: 'fix or remove the task' });
        continue;
      }
      const problems = validateTaskDeclaration(decl);
      if (problems.length) {
        errors.push({ pack: pack.id, task: name, what: `${relative(root, mjs)} is not a valid task declaration: ${problems.map((p) => p.what).join('; ')}`, fix: problems[0].fix });
        continue;
      }
      if (decl.id !== name) {
        errors.push({ pack: pack.id, task: name, what: `task in ${relative(root, taskDir)} declares id "${decl.id}" but its directory is "${name}"`, fix: 'rename the directory to the task id, or set the id to the directory name' });
        continue;
      }
      tasks.push({
        pack: pack.id,
        id: decl.id,
        taskDir,
        taskPath: `${relative(root, taskDir).split('\\').join('/')}/task.md`,
        decl,
      });
    }
  }
  return { tasks, errors };
}
