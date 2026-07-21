import { dirname, join, normalize } from 'node:path';
import { extractLinks } from '../../checks/lib/markdown.mjs';
import { finding } from '../../checks/lib/findings.mjs';

// A fixed-string hit on a deleted path can still be innocent: a rename that keeps the
// same basename (e.g. old.sh moving to some/old.sh) makes every mention of the new,
// still-existing path also contain the deleted one as a suffix.
// Widen each match to its enclosing path-like token and check whether that longer
// token resolves — if every occurrence on the line names a path that still exists,
// this hit isn't actually dangling.
const PATH_CHAR = /[\w./@-]/;

function widenToken(text, start, end) {
  let s = start;
  let e = end;
  while (s > 0 && PATH_CHAR.test(text[s - 1])) s--;
  while (e < text.length && PATH_CHAR.test(text[e])) e++;
  return text.slice(s, e);
}

function referencesSurvivingPath(hit, gone, ctx) {
  let idx = hit.text.indexOf(gone);
  if (idx === -1) return false; // shouldn't happen, but nothing to widen
  while (idx !== -1) {
    const token = widenToken(hit.text, idx, idx + gone.length);
    const resolved = normalize(join(dirname(hit.file), token));
    const survives = (token !== gone && ctx.exists(token)) || ctx.exists(resolved);
    if (!survives) return false;
    idx = hit.text.indexOf(gone, idx + 1);
  }
  return true;
}

// A deleted path already governed by an active baseline migration (migrations/) isn't
// a stale reference — it's the declared legacy shape a migration record deliberately
// keeps naming (in its own aliases, and in every reader/doc that resolves or documents
// them) until the fleet converges and it retires. Read the spec files synchronously
// (checks run sync — see checks/lib/hooklog.mjs), matching on basename since a legacy
// alias is usually written with a different (e.g. consumer-side) path prefix than the
// bare deleted path this branch reports.
const MIGRATIONS_DIR_RE = /^migrations\/active_migrations\/.*\.mjs$/;

function migrationGoverns(gone, ctx) {
  const base = gone.split('/').pop();
  for (const file of ctx.files.filter((f) => MIGRATIONS_DIR_RE.test(f) && !f.endsWith('.test.mjs'))) {
    const text = ctx.read(file);
    if (text && text.includes(base)) return true;
  }
  return false;
}

const rule = {
  id: 'reference-integrity',
  severity: 'blocking',
  description: 'Relative Markdown links must resolve, and no tracked file may reference a deleted path',
  doc: 'skills/repo-text-sweeps/SKILL.md',
  why: 'a dangling reference breaks silently — no test fails when a doc link or index entry points at nothing',

  run(ctx) {
    const out = [];

    for (const file of ctx.files.filter((f) => f.endsWith('.md'))) {
      const text = ctx.read(file);
      if (text === null) continue;
      for (const { target, line } of extractLinks(text)) {
        const resolved = normalize(join(dirname(file), target));
        if (resolved.startsWith('..')) continue; // outside the repo — not verifiable here
        if (!ctx.exists(resolved)) {
          out.push(finding(rule, {
            file, line,
            what: `relative link → ${target} resolves to ${resolved}, which does not exist`,
            fix: 'correct the path or restore the target; when moving or deleting a file, update every inbound reference in the same change',
          }));
        }
      }
    }

    for (const gone of ctx.deleted) {
      if (migrationGoverns(gone, ctx)) continue;
      for (const hit of ctx.grepTracked(gone)) {
        if (hit.file === gone) continue;
        if (referencesSurvivingPath(hit, gone, ctx)) continue;
        out.push(finding(rule, {
          file: hit.file, line: hit.line,
          what: `still references ${gone}, which this branch deletes`,
          fix: `update or remove the reference — grep the whole tree for "${gone}" and fix every hit in this same change`,
        }));
      }
    }

    return out;
  },
};

export default rule;
