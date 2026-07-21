import { finding } from '../../engine/checks/helpers/findings.mjs';
import { humanTurns, assistantTextAfter, classificationLine } from '../../engine/checks/helpers/session-transcript.mjs';

// Conversation-surface rule: the assessment itself is judgment no check can
// verify, but that an assessment was explicitly MADE is checkable — the reply
// to the owner's latest comment must carry the classification line. Only the
// latest comment is judged: earlier turns were judged at their own Stops, and
// a transcript is append-only, so an old omission could never converge.
const rule = {
  id: 'comment-classification',
  severity: 'blocking',
  description: 'The reply to the owner\'s latest comment must declare an explicit `Comment class:` line',
  doc: 'packs/basics/RULES.md',
  why: 'the class decides the flow (correction / feature / process-change); an unclassified comment tends to become an unrouted one-off patch',

  run(ctx) {
    const entries = ctx.conversation();
    if (!entries) return [];
    const turns = humanTurns(entries);
    if (!turns.length) return [];
    const last = turns[turns.length - 1];
    if (classificationLine(assistantTextAfter(entries, last.index))) return [];
    const excerpt = last.text.replace(/\s+/g, ' ').slice(0, 70);
    return [finding(rule, {
      file: '(conversation)',
      what: `the reply to the owner's latest comment ("${excerpt}…") declares no \`Comment class:\` line`,
      fix: 'state the classification explicitly — emit a line `Comment class: correction | feature | process-change | other` (a mixed comment names each part) in your reply text',
    })];
  },
};

export default rule;
