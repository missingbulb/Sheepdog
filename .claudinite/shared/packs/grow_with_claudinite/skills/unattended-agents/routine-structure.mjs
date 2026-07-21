import { dirname, join, basename } from 'node:path';
import { finding } from '../../../../engine/checks/helpers/findings.mjs';

// A routine is a folder whose entry point is `routine.md` (the standard name),
// alongside the deterministic scripts it invokes. This check asserts the
// prose↔script wiring that the unattended-agents skill mandates.
//
// RELEVANCE FIRST (see engine/checks/README.md "Adding a rule"): a skill check has no
// declaration gate — the engine runs it on EVERY repo, including ones with no
// routines — so `run` must detect relevance before asserting anything. Here the
// signal is a `routine.md` existing: `routineDirs` is empty on any repo without
// one, every loop below is over an empty set, and the check no-ops. Keep that
// gate narrow and up front; a broad signal would fire false findings everywhere.
const ENTRY = 'routine.md';
const PHASE_SCRIPTS = ['preconditions.sh', 'postconditions.sh'];

// Direct-child files of dir `d` within `files` matching `pred` (not descendants).
function children(files, d, pred) {
  const prefix = d ? d + '/' : '';
  return files.filter((f) => {
    if (!f.startsWith(prefix)) return false;
    const rel = f.slice(prefix.length);
    return rel.length > 0 && !rel.includes('/') && pred(rel);
  });
}

const rule = {
  id: 'routine-structure',
  severity: 'blocking',
  description: 'A routine folder has a routine.md entry point wired to the scripts it invokes',
  doc: 'skills/unattended-agents/SKILL.md',
  why: 'a routine is prose (read) + scripts (executed); a dangling invocation or an orphan/entry-less script means the agent runs the wrong thing or the job hides where it is never read',

  run(ctx) {
    const out = [];
    const files = ctx.files;

    const routineDirs = new Set(
      files.filter((f) => basename(f) === ENTRY).map((f) => dirname(f)),
    );

    for (const dir of routineDirs) {
      const text = ctx.read(join(dir, ENTRY));
      if (text === null) continue;
      const lines = text.split('\n');
      const scripts = children(files, dir, (rel) => rel.endsWith('.sh'));

      // 1. Every `bash …/x.sh` the prose tells you to run must resolve.
      lines.forEach((ln, i) => {
        const m = /\b(?:bash|sh)\s+(\S+\.sh)\b/.exec(ln);
        if (!m) return;
        const p = m[1];
        if (ctx.exists(p) || ctx.exists(join(dir, p))) return;
        out.push(finding(rule, {
          file: join(dir, ENTRY), line: i + 1,
          what: `invokes ${p}, which does not exist`,
          fix: 'correct the path or restore the script; a routine must not tell the agent to run a missing file',
        }));
      });

      // 2. Every script in the folder must be invoked by the entry point — an
      //    uninvoked script is dead weight or an indirection that never ran.
      for (const s of scripts) {
        if (text.includes(basename(s))) continue;
        out.push(finding(rule, {
          file: s, line: null, severity: 'advisory',
          what: `is never invoked by ${join(dir, ENTRY)}`,
          fix: `invoke it from ${ENTRY}, or remove it — a script the routine never runs does not earn its place`,
        }));
      }

      // 3. Each script must be a real executable script (shebang first line).
      for (const s of scripts) {
        const body = ctx.read(s);
        if (body === null || body.startsWith('#!')) continue;
        out.push(finding(rule, {
          file: s, line: 1, severity: 'advisory',
          what: 'has no shebang line',
          fix: 'start the script with a shebang (e.g. #!/usr/bin/env bash) so it runs standalone',
        }));
      }
    }

    // 4. A folder carrying phase scripts but no routine.md has lost its entry
    //    point — the standard name is how the routine is found and run.
    const phaseDirs = new Set(
      files.filter((f) => PHASE_SCRIPTS.includes(basename(f))).map((f) => dirname(f)),
    );
    for (const dir of phaseDirs) {
      if (routineDirs.has(dir)) continue;
      out.push(finding(rule, {
        file: join(dir, PHASE_SCRIPTS.find((n) => ctx.exists(join(dir, n))) || PHASE_SCRIPTS[0]),
        line: null,
        what: `sits in a routine folder with no ${ENTRY} entry point`,
        fix: `add ${ENTRY} as the folder's entry point (it invokes these scripts), or move the scripts out`,
      }));
    }

    return out;
  },
};

export default rule;
