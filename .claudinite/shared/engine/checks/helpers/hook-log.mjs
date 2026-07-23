// Durable hook log — a timestamp and what each hook is doing, appended to
// .claudinite-hooks.log at the PROJECT ROOT (outside .claudinite/). It turns an
// intermittent "the hook didn't work" into something inspectable: no lines at
// all ⇒ the hook never triggered; a `start` with no matching `done` ⇒ it
// triggered but failed mid-execution.
//
// The line format is mirrored by the bash logger inlined in
// engine/hooks/session-start-command.sh — keep the two in step:
//   <iso-utc> run=<id> <hook>: <message>
//
// Best effort: logging must never throw or block a hook, so every failure is
// swallowed.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export function hooklog(hook, message) {
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const run = process.env.CLAUDINITE_HOOK_RUN || String(process.pid);
    const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const line = `${ts} run=${run} ${hook}: ${message}\n`;
    appendFileSync(join(root, '.claudinite-hooks.log'), line);
    try { process.stderr.write(line); } catch { /* stderr closed — the file line still landed */ }
  } catch { /* logging must never break a hook */ }
}
