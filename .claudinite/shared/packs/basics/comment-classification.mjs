import { finding } from '../../engine/checks/helpers/findings.mjs';

// Only the latest owner comment is judged: earlier turns were judged at their
// own Stops, and a transcript is append-only, so an old omission never converges.
const rule = {
  id: 'comment-classification',
  severity: 'blocking',
  description: 'The reply to the owner\'s latest comment must declare an explicit `Comment class:` line',
  doc: 'packs/basics/RULES.md',
  scope: 'work',
  why: 'the class decides the flow (correction / feature / process-change); an unclassified comment tends to become an unrouted one-off patch',

  run(work) {
    const lastOwnerTurn = work.conversation().ownerTurns().last();
    if (!lastOwnerTurn.exists || lastOwnerTurn.classified()) return [];
    return [finding(rule, {
      file: '(conversation)',
      what: `the reply to the owner's latest comment ("${lastOwnerTurn.excerpt(70)}…") declares no \`Comment class:\` line`,
      fix: 'state the classification explicitly — emit a line `Comment class: correction | feature | process-change | other` (a mixed comment names each part) in your reply text',
    })];
  },
};

export default rule;
