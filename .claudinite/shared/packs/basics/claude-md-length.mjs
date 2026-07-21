import { finding } from '../../engine/checks/helpers/findings.mjs';

const LIMIT = 200;

// Converted from authoring-agent-docs: "Target under 200 lines per CLAUDE.md;
// longer files consume more context and reduce adherence." Directional → advisory.
const rule = {
  id: 'claude-md-length',
  severity: 'advisory',
  description: 'A CLAUDE.md over ~200 lines costs context and reduces adherence',
  doc: 'skills/authoring-agent-docs/SKILL.md',
  why: 'everything in CLAUDE.md loads every session; past ~200 lines it crowds out the rules that matter',

  run(ctx) {
    // Root CLAUDE.md only — the one that definitely loads every session. A nested
    // or fixture CLAUDE.md may never load, so flagging its length would be a false
    // positive (an adversarial-mining finding).
    const text = ctx.read('CLAUDE.md');
    if (text === null) return [];
    const lines = text.split('\n').length;
    if (lines <= LIMIT) return [];
    return [finding(rule, {
      file: 'CLAUDE.md', line: LIMIT + 1,
      what: `${lines} lines (target under ${LIMIT})`,
      fix: 'move multi-step procedures to skills and part-of-repo rules to path-scoped packs; keep CLAUDE.md to always-true facts',
    })];
  },
};

export default rule;
