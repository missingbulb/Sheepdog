import { finding } from '../../../../engine/checks/helpers/findings.mjs';
import { interviewState } from './interview.mjs';

// Adoption-interview hygiene, owned by the pack that owns the interview. A STORED
// answer whose question the pack no longer declares (renamed or removed upstream)
// is a stale intent that silently stops matching — advisory, never run-failing,
// so a canon-side question rename can't fail the fleet's CI overnight. This is a
// grow_with_claudinite concern, not the engine's: it rides this pack's activation
// like any skill-owned check, so a repo without the lifecycle pack never runs it
// (and the engine imports no pack to do so).
//
// PENDING questions are deliberately NOT a finding — they surface only as the
// mild SessionStart note (interview.mjs `check`), so an unattended run is never
// blocked on a question nobody is present to answer. A MALFORMED `questions`
// declaration is a manifest load fault the pack registry reports, not here.
//
// Reads ctx.packs (the discovered pack objects the runner attaches) so the check
// runs synchronously without re-discovering packs.
const rule = {
  id: 'interview-answer-stale',
  severity: 'advisory',
  description: 'A stored adoption-interview answer names a question its pack still declares',
  doc: 'packs/README.md',
  why: 'a stale answer silently stops matching its question, so the stored intent goes unread and the interview re-asks',

  run(ctx) {
    if (!ctx.packs) return [];
    const { stale } = interviewState(ctx.packs, ctx.config);
    return stale.map(({ packId, answerId }) => finding(rule, {
      file: '.claudinite-checks.json',
      what: `the "${packId}" pack entry stores an answer for "${answerId}", a question the pack no longer declares`,
      fix: 'remove the stale answer, or re-key it to the renamed question id',
    }));
  },
};

export default [rule];
