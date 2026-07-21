import { finding } from '../../checks/lib/findings.mjs';

// Flat-literal count — raw bytes, comments included, no regex. A value wrapped
// across a line break is invisible here (as it is to a grep/sed rename too), so a
// guarded value must stay on one line wherever it appears.
function countOccurrences(text, value) {
  let n = 0;
  let pos = 0;
  while ((pos = text.indexOf(value, pos)) !== -1) {
    n += 1;
    pos += value.length;
  }
  return n;
}

// Module technologies whose files can `import` a shared definition from one
// another (the JS/TS family). A shared-constant only earns its keep for a value
// copied across files that CAN'T share an import — JSON manifests, a YAML
// workflow + a JS module, prod code + a config file. When every watched file is
// one of these, the copy is redundant: export the value once and import it.
const IMPORTABLE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts',
]);

function fileExtension(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

// Data-driven drift guard for a value that must be copied across files that can't
// share an import (a label spanning a YAML workflow guard and a JS module; a repo
// slug in prod code and its test). The cases are declared per-repo in
// .claudinite-checks.json under "sharedConstants"; an empty/absent list is a no-op.
// Each entry is { what, value, counts } — value is the literal, counts maps a
// repo-relative path to the exact number of times it must appear, and what names
// the places and why the split is forced (so the guard self-documents). A count
// mismatch means a rename touched some copies but not all.
//
// A value that must stay in sync but *changes over time* (a version string bumped
// each release) sets "regex": true and gives a pattern for value. Then value is
// matched as a regular expression, counts still bound the matches per file, and
// every matched substring across all the declared files must be byte-identical —
// so the guard catches drift without pinning (and re-pinning) the current value.
//
// An entry whose watched files are all the same import-capable technology (all
// JS/TS) is a misuse, not drift: those files CAN share an import, so the value
// should live in one module and be imported — not copied and byte-counted. The
// guard flags such an entry so the redundancy is fixed at the source.
const rule = {
  id: 'shared-constants',
  severity: 'blocking',
  description: 'A value copied across files that can\'t share an import must appear the declared number of times in each (and, in regex mode, be identical everywhere)',
  doc: 'skills/engineering-practices/SKILL.md',
  why: 'a value duplicated across files that can\'t share an import drifts silently when a rename or bump lands in some but not all',

  run(ctx) {
    const out = [];
    const cases = ctx.config.sharedConstants ?? [];

    cases.forEach((entry, i) => {
      const label = entry && typeof entry.value === 'string' && entry.value ? `"${entry.value}"` : `entry #${i + 1}`;

      const wellFormed =
        entry &&
        typeof entry.value === 'string' && entry.value.length > 0 &&
        typeof entry.what === 'string' && entry.what.trim().length > 0 &&
        entry.counts && typeof entry.counts === 'object' && !Array.isArray(entry.counts) &&
        Object.keys(entry.counts).length > 0;

      if (!wellFormed) {
        out.push(finding(rule, {
          file: '.claudinite-checks.json',
          what: `malformed sharedConstants ${label}: needs a non-empty "value", a "what" naming the places and why the split is forced, and a non-empty "counts" map`,
          fix: 'shape each entry as { "what": "...", "value": "...", "counts": { "repo/relative/path": N } }',
        }));
        return;
      }

      // Redundancy guard: a shared-constant is for a value copied across files
      // that CAN'T share an import. If every watched file is the same
      // import-capable technology (all JS/TS), they can — so the entry is the
      // wrong tool; the value should be exported once and imported.
      const paths = Object.keys(entry.counts);
      if (paths.length > 1 && paths.every((p) => IMPORTABLE_EXTENSIONS.has(fileExtension(p)))) {
        out.push(finding(rule, {
          file: '.claudinite-checks.json',
          what: `sharedConstants ${label} watches only same-technology files that can share an import (${paths.join(', ')}) — a shared-constant is for a value copied across files that CAN'T`,
          fix: `export ${label} from one module and import it into the other(s), then drop this entry (${entry.what})`,
        }));
        return;
      }

      const isRegex = entry.regex === true;
      let regex = null;
      if (isRegex) {
        try {
          regex = new RegExp(entry.value, 'g');
        } catch (e) {
          out.push(finding(rule, {
            file: '.claudinite-checks.json',
            what: `sharedConstants ${label} sets "regex": true but "value" is not a valid regular expression: ${e.message}`,
            fix: 'fix the pattern, or drop "regex": true to match the value as a flat literal',
          }));
          return;
        }
      }

      const matched = []; // { rel, value } across files — for the regex-mode equality check
      for (const [rel, expected] of Object.entries(entry.counts)) {
        if (!Number.isInteger(expected) || expected < 0) {
          out.push(finding(rule, {
            file: '.claudinite-checks.json',
            what: `sharedConstants ${label} gives a non-integer count for ${rel}`,
            fix: `set "counts"["${rel}"] to the number of times ${label} must appear in that file`,
          }));
          continue;
        }
        const text = ctx.read(rel);
        if (text === null) {
          out.push(finding(rule, {
            file: '.claudinite-checks.json',
            what: `sharedConstants ${label} watches ${rel}, but that file does not exist`,
            fix: `the value's home moved or was removed — update the entry's "counts" (${entry.what})`,
          }));
          continue;
        }
        let actual;
        if (isRegex) {
          const hits = text.match(regex) || [];
          actual = hits.length;
          for (const h of hits) matched.push({ rel, value: h });
        } else {
          actual = countOccurrences(text, entry.value);
        }
        if (actual !== expected) {
          out.push(finding(rule, {
            file: rel,
            what: `expected ${expected} occurrence(s) of ${label} but found ${actual}`,
            fix: `a rename left this file out of sync — fix the value here, or adjust the entry's count if the change is intended (${entry.what})`,
          }));
        }
      }

      // Regex mode: the matched substrings must agree across every declared file.
      if (isRegex && matched.length > 1) {
        const distinct = [...new Set(matched.map((m) => m.value))];
        if (distinct.length > 1) {
          const detail = distinct
            .map((v) => `${JSON.stringify(v)} in ${matched.filter((m) => m.value === v).map((m) => m.rel).join(', ')}`)
            .join('; ');
          out.push(finding(rule, {
            file: '.claudinite-checks.json',
            what: `sharedConstants ${label} matches differing values across files — ${detail}`,
            fix: `bring the copies back into sync (${entry.what})`,
          }));
        }
      }
    });

    return out;
  },
};

export default rule;
