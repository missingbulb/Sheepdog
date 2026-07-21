#!/usr/bin/env node
// Adoption interviews — the mandatory questions a pack asks when a project
// adopts it. A pack that needs the project's INTENT before it can provide value
// (barriers with no graph is a silent no-op) declares its questions in an
// optional `questions` field on its pack.mjs:
//
//   questions: [{ id: 'goals', prompt: '…', distill: '…' }]
//
// Stable-id'd, because the answers live VERBATIM on the pack's entry in
// .claudinite-checks.json (`answers: { "<question-id>": "<answer>" }` — see
// engine/checks/README.md): the settings file records the project's intent beside the
// `config` distilled from it. The GAP — declared question ids minus answered
// ids — drives the asking: at adoption every question is pending; when the
// canon later adds a question to a pack, just that one surfaces in every
// consumer; a pack with no questions adds nothing. An answered question stays
// answered — "n/a, none wanted" is an answer, distinct from never-asked.
//
//   node interview.mjs check   SessionStart step: when active packs have
//                              unanswered questions, emit a MILD context note
//                              asking the assistant to interview the owner at a
//                              natural moment — and telling an unattended
//                              session to ignore it entirely. Deliberately
//                              never a conformance finding: a nightly run must
//                              not be blocked on a question nobody is present
//                              to answer. Strictness lives only in the
//                              bootstrap adoption flow (bootstrap.md Part 6),
//                              where the owner is present by construction.
import { pathToFileURL } from 'node:url';
import { loadPacks, isActive } from '../../../../engine/pack_loader/pack-registry.mjs';
import { loadConfig } from '../../../../engine/checks/helpers/repo-context.mjs';

// A pack's declared questions, validated: `questions` must be an array of
// { id, prompt, distill? } with non-empty string ids and prompts, ids unique
// within the pack. A malformed entry is reported and skipped — one bad question
// must not mute the pack's valid ones (the registry's fail-soft posture).
export function packQuestions(pack) {
  const questions = [];
  const errors = [];
  const src = pack.questions;
  if (src === undefined || src === null) return { questions, errors };
  if (!Array.isArray(src)) {
    errors.push({
      what: `the "${pack.id}" pack declares a non-array "questions"`,
      fix: 'make questions an array of { id, prompt } entries',
    });
    return { questions, errors };
  }
  const seen = new Set();
  for (const q of src) {
    if (q === null || typeof q !== 'object' || typeof q.id !== 'string' || !q.id
      || typeof q.prompt !== 'string' || !q.prompt) {
      errors.push({
        what: `the "${pack.id}" pack declares a malformed question ${JSON.stringify(q)}`,
        fix: 'give each question a non-empty string "id" and "prompt"',
      });
      continue;
    }
    if (seen.has(q.id)) {
      errors.push({
        what: `the "${pack.id}" pack declares question id "${q.id}" twice`,
        fix: 'question ids must be unique within the pack — rename one',
      });
      continue;
    }
    seen.add(q.id);
    questions.push(q);
  }
  return { questions, errors };
}

// The repo's interview state: for each ACTIVE pack, the declared questions its
// entry hasn't answered (`pending`) and the stored answers whose question the
// pack no longer declares (`stale` — renamed or removed upstream), plus any
// malformed `questions` declarations (`errors`). Pure — `config` is
// loadConfig's normalized shape. The callers split the enforcement posture:
// `check` (below) surfaces pending as a mild SessionStart note and NEVER as a
// finding; the runner surfaces stale as an ADVISORY config finding (visible,
// never run-failing — a canon-side question rename must not fail the fleet's
// CI overnight) and errors as blocking ones, like any broken manifest.
export function interviewState(packs, config) {
  const pending = [];
  const stale = [];
  const errors = [];
  const entryById = new Map((config.packEntries ?? []).map((e) => [e.id, e]));
  for (const pack of packs) {
    if (!isActive(pack, config)) continue;
    const entry = entryById.get(pack.id);
    // A dependency the declaration resolver materialized (`via`) wasn't chosen
    // by the project — it's there because another pack's ability rides it.
    // Until the project engages with it (its own config or answers on the
    // entry), its adoption questions don't apply: the interview guides a
    // CHOSEN adoption, and nagging every consumer whose baseline pulls a
    // mechanism pack in would train owners to ignore the note.
    if (entry?.via?.length && entry.config === undefined && !Object.keys(entry.answers ?? {}).length) continue;
    const { questions, errors: qErrors } = packQuestions(pack);
    errors.push(...qErrors);
    const answers = entry?.answers ?? {};
    const unanswered = questions.filter((q) => !(q.id in answers));
    if (unanswered.length) pending.push({ packId: pack.id, questions: unanswered });
    // With a malformed declaration the declared-id set is unreliable, so skip
    // stale detection for this pack — the blocking error already says what's wrong.
    if (qErrors.length) continue;
    const declaredIds = new Set(questions.map((q) => q.id));
    for (const id of Object.keys(answers)) {
      if (!declaredIds.has(id)) stale.push({ packId: pack.id, answerId: id });
    }
  }
  return { pending, stale, errors };
}

// The SessionStart note for pending questions. Mild by design, and explicitly
// self-defusing for unattended sessions — the wording IS the guarantee that a
// nightly run is never derailed by it.
export function renderPending(pending) {
  const lines = [
    'Pack adoption interview pending — the active packs below declare adoption questions this '
    + 'project has not answered. In an INTERACTIVE session, at a natural moment (not mid-task), '
    + 'ask the owner each question via AskUserQuestion, record the answer VERBATIM in '
    + '.claudinite-checks.json on that pack\'s entry as answers: { "<question-id>": "<answer>" } '
    + '("n/a — none wanted" is a valid answer and stops the asking), and where the question '
    + 'carries a distill note, derive the entry\'s config from the answer. This is a mild '
    + 'reminder, never a gate: in an unattended session, or when it would derail the work at '
    + 'hand, ignore it entirely and leave it for a later interactive session.',
  ];
  for (const p of pending) {
    for (const q of p.questions) {
      lines.push(`- ${p.packId} / ${q.id}: ${q.prompt}${q.distill ? ` [distill: ${q.distill}]` : ''}`);
    }
  }
  return lines.join('\n');
}

async function check(projectRoot) {
  const config = loadConfig(projectRoot);
  const packs = await loadPacks({ localRoot: projectRoot });
  const { pending } = interviewState(packs, config);
  if (pending.length) process.stdout.write(`${renderPending(pending)}\n`);
}

// CLI — but importable (the tests and the runner import the pure helpers above).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cmd = process.argv[2];
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (cmd === 'check') {
    await check(projectRoot); // fails soft upstream — the orchestrator tolerates a step failure
  } else {
    process.stderr.write('usage: interview.mjs check\n');
    process.exit(2);
  }
}
