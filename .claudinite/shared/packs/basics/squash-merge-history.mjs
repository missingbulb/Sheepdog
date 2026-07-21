import { finding } from '../../checks/lib/findings.mjs';

// The effect check behind the squash-only platform setting, scoped to the work:
// a merge commit the current change introduces (on HEAD's first-parent chain
// since the merge-base) is a merge that would land non-squash and proves the
// setting was off or bypassed. It tests the work, not the repo's whole history —
// pre-existing merges already on the base are out of scope. One finding per
// introduced merge, keyed by sha.
const rule = {
  id: 'squash-merge-history',
  severity: 'blocking',
  description: 'A change introduces no merge commits (it lands squashed, not merged)',
  doc: 'skills/merge-to-main/SKILL.md',
  why: 'the squash-only repo setting can be off or bypassed; a merge commit in the work is the effect that proves it',

  run(ctx) {
    return ctx.introducedMergeCommits().map(({ sha, subject }) =>
      finding(rule, {
        file: `${ctx.branch || 'HEAD'}@${sha}`,
        what: `merge commit introduced by this change: ${subject}`,
        fix: 'rebase to drop the merge commit (git pull --rebase, or git rebase onto the base) so the branch lands squashed; keep squash-only enabled in the repo settings, or turn the rule off if the project deliberately runs a non-squash policy named in its CLAUDE.md',
      })
    );
  },
};

export default rule;
