import { dirname, join, normalize } from 'node:path';
import { extractLinks } from '../../engine/checks/helpers/markdown.mjs';
import { finding } from '../../engine/checks/helpers/findings.mjs';

// A label counts as path-like only when it has at least one slash; a bare
// basename label can't be reliably resolved and flags nothing.
const PATH_LIKE = /^\.{0,2}\/?[\w.-]+(\/[\w.-]+)+$/;

const rule = {
  id: 'markdown-link-labels',
  severity: 'blocking',
  description: 'A Markdown link whose visible label is a path must agree with its target',
  doc: 'skills/repo-text-sweeps/SKILL.md',
  why: 'a Markdown link carries its path twice — an href-only rewrite leaves the doc pointing right but reading wrong',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => f.endsWith('.md'))) {
      const text = ctx.read(file);
      if (text === null) continue;
      for (const { label, target, line } of extractLinks(text)) {
        const cleanLabel = label.split('#')[0];
        if (!PATH_LIKE.test(cleanLabel)) continue;
        const resolvedTarget = normalize(join(dirname(file), target));
        const labelFromFile = normalize(join(dirname(file), cleanLabel));
        const labelFromRoot = normalize(cleanLabel);
        if (resolvedTarget !== labelFromFile && resolvedTarget !== labelFromRoot) {
          out.push(finding(rule, {
            file, line,
            what: `label reads "${label}" but the target resolves to ${resolvedTarget}`,
            fix: 'rewrite the visible label to match the target (or vice versa) — both halves carry the path',
          }));
        }
      }
    }
    return out;
  },
};

export default rule;
