# Working discipline

The working discipline that isn't itself a GitHub operation — general habits for how to approach a change, independent of any one project.

Start every requested change from the *problem*, not the solution. When the owner asks for a change, don't begin implementing it until the two of you share an explicit understanding of the problem it's meant to solve **and** have agreed that the requested change is the best way to solve it — a different fix, or no change at all, may serve the underlying problem better. Treat the request as a description of a desired outcome, not a specification to execute on sight; surface your read of the problem, raise a better approach if you see one, and reach consensus first. This applies to any repository, not just this one.

An interactive comment from the owner carries one of three build-relevant intents — or none of them — and the classification decides where the change lands and what must exist before any fix. Open your reply to an owner comment with an explicit classification line — `Comment class: correction | feature | process-change | other` (`other` covers questions, approvals, and command phrases; a mixed comment names each part) — the assessment itself stays judgment.

1. **A correction** — you misunderstood something. Repair the shared understanding, then rework what the misread already touched — the artifact changes as much as the correction demands; what doesn't appear is a new requirement or rule.
2. **A feature** — a feature run: agree on the requirement, record it in the project's requirements document (its executable spec, where it keeps one), write the test that proves it and watch it fail, then implement until it passes.
3. **A process change** — the owner is changing *how* work is done. The change lands as durable rules in the project's local scope — its own local packs (in Claudinite itself, its packs) — routed through the mechanism promotion ladder (platform setting → hook → check → skill → prose); promoting a rule into the shared canon is the growth lifecycle's separate call, not the interactive session's. Once the intent is understood, author the assurance first: the check the future world must satisfy. Execute it and watch it fail — the failure is the evidence it detects exactly what the owner was worried about — and only then make the fixes that turn it green. When the ladder lands the rule at prose (an in-flight judgment rule no check can carry), the same step is demonstrating the gap: show the corpus doesn't already cover the rule before writing it.

The two build modes share one spine: state the expectation in its durable home first, watch it fail against the current world, then change the world to satisfy it. A fix made before its assurance exists can never show it addressed what the owner actually asked for — and an unrouted comment tends to become a one-off patch where a requirement or a rule should have accumulated.

Confirm a behavior isn't already provided before building a mechanism for it — verify the gap against a real run first; the cheapest fix is often that it already works.

When feedback flags a misunderstanding, don't reflexively expand the artifact to compensate. First check whether it's already correct — if it is, say so and push back rather than editing; a misread doesn't imply the text is wrong (the sibling of the rule above). And size writing to its idea: "open one issue" takes a sentence, not three paragraphs — prose padded to preempt confusion usually breeds it.

When correcting or auditing an artifact against an authoritative source, derive the corrected version from the *source* before reading the existing draft — reading the draft first anchors you to its framing and quietly carries its errors into your "fix." Build from the source, then diff against the old draft to surface what was actually wrong; a clean-room rebuild catches biases an edit-in-place pass silently inherits.

Fix build/test/CI warnings, don't tolerate them: a clean run with no warnings makes a genuinely new warning or error stand out, so noise here costs detection later. Prefer a small, targeted fix that addresses the *cause* in the same change.

Suppressing a warning — muting it with a flag (e.g. `--disable-warning`), `eslint-disable`, swallowing it, etc. — is **not** a small fix: it hides the signal instead of resolving it. Never reach for suppression as the quick path — it's only ever a deliberate, reviewed decision, made once the real fix has been weighed and rejected, never an unattended default. A suppression you do keep must **carry its reason at the site**: an explanation on the suppression line, or in the comment immediately above it, saying why the fix was rejected. That inline reason *is* the review record — it's what separates a considered suppression from a reflexive mute, and it's why the suppression needs no second justification recorded elsewhere.

When a warning can't be fixed with a small cause-addressing change now without hindering current work (e.g. it's waiting on an upstream release, or the real fix is a larger refactor), open a dedicated issue for it (unless one is already open) so it's tracked and not lost — then move on. Resolving it (real fix, or a consciously-chosen suppression) happens in that issue's own change.

An approval — to merge, to ship, to proceed — applies only *backward*, to the work already in front of the owner when it's given, never to anything requested or done *after* it. A later follow-up, even a fix to the just-approved change, needs its own explicit approval; don't carry one approval forward, and don't treat a chosen answer to a multiple-choice prompt as authorization just because an option's wording mentioned the action. When in doubt, surface the new state and wait for a fresh approval.

# The task lifecycle

The issue → branch → PR lifecycle every new task follows, independent of any one project; this section keeps the method. The rest of the git/GitHub procedures live in the `git-github-advanced` skill.

For every new task:

1. Create a GitHub issue describing the task before starting work.
2. Develop on a branch; reference that issue number in commit messages (e.g. `Refs #123`, `Fixes #123`, or `Closes #123`).
3. Update the issue's status (comments / close) as work progresses and when it's done.
