import { dirname, join, normalize } from 'node:path';
import { finding } from '../../engine/checks/helpers/findings.mjs';

const CODE_EXT = /\.(mjs|cjs|jsx?|tsx?)$/;
const CODE_REF = /(?:from\s+|require\(\s*|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

// Mandated locations and test files are the doc's two exemptions: their long
// references are forced by a tool contract or a test-location convention.
const EXEMPT_SOURCE = (file) =>
  file.startsWith('.github/') || file.startsWith('.claude/') ||
  /(^|\/)(test|tests|__tests__|spec)\//.test(file) || /\.(test|spec)\./.test(file);

function distance(fromDir, toDir) {
  const a = fromDir === '.' ? [] : fromDir.split('/');
  const b = toDir === '.' ? [] : toDir.split('/');
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return (a.length - common) + (b.length - common);
}

const rule = {
  id: 'file-placement',
  severity: 'advisory',
  description: 'A code file should mostly reference files at folder distance 0–2; distance 3+ is reach',
  doc: 'skills/file-placement/SKILL.md',
  why: 'the folder tree should encode the dependency graph; far reaches make it lie',

  run(ctx) {
    const out = [];
    for (const file of ctx.files) {
      if (EXEMPT_SOURCE(file)) continue;
      // Reference-distance is a *code* dependency-graph metric — a docs corpus's
      // tree mirrors topics, not a dependency graph, so cross-topic doc citations
      // are healthy, not a smell. Markdown links are governed by reference-integrity
      // and markdown-link-labels instead.
      if (!CODE_EXT.test(file)) continue;
      const text = ctx.read(file);
      if (text === null) continue;

      const refs = [];
      text.split('\n').forEach((lineText, i) => {
        let m;
        CODE_REF.lastIndex = 0;
        while ((m = CODE_REF.exec(lineText)) !== null) refs.push({ target: m[1], line: i + 1 });
      });

      for (const { target, line } of refs) {
        const resolved = normalize(join(dirname(file), target));
        if (resolved.startsWith('..')) continue;
        const d = distance(dirname(file), dirname(resolved));
        if (d >= 3) {
          out.push(finding(rule, {
            file, line,
            what: `references ${target} at distance ${d}`,
            fix: 'move one of the two nearer the other, lift the shared dependency to a common ancestor, or accept it in .claudinite-checks.json with a reason if it is a deliberate cross-cutting concern',
          }));
        }
      }
    }
    return out;
  },
};

export default rule;
