import { finding } from '../../engine/checks/helpers/findings.mjs';

// Each marker pairs a `probe` (does this line suppress a warning at all?) with a
// `bare` pattern that matches the directive *and its rule code(s)* running to
// end-of-line with nothing after them. A line whose marker matches `bare` carries
// no same-line reason; anything trailing the codes (an ESLint `-- reason`, an
// appended `# why`, a `// safe: …`) breaks `bare` and counts as self-documenting.
const MARKERS = [
  { probe: /eslint-disable/, bare: /eslint-disable(-next-line|-line)?(\s+[\w@/-]+(\s*,\s*[\w@/-]+)*)?\s*(\*\/)?\s*$/ },
  { probe: /@ts-ignore/, bare: /@ts-ignore\s*(\*\/)?\s*$/ },
  { probe: /@ts-nocheck/, bare: /@ts-nocheck\s*(\*\/)?\s*$/ },
  { probe: /\bnoqa\b/, bare: /noqa(:\s*[A-Z0-9]+(\s*,\s*[A-Z0-9]+)*)?\s*$/ },
  { probe: /pylint:\s*disable/, bare: /pylint:\s*disable(-next)?=[\w-]+(\s*,\s*[\w-]+)*\s*(\*\/)?\s*$/ },
  { probe: /@SuppressWarnings/, bare: /@SuppressWarnings\s*\(\s*(\{[^}]*\}|"[^"]*"|'[^']*')\s*\)\s*$/ },
  { probe: /#\s*type:\s*ignore/, bare: /#\s*type:\s*ignore(\[[\w,\s-]+\])?\s*$/ },
];

// The line immediately above documents the suppression when it's a real comment
// carrying prose — not blank, not decoration (`*/`), and not itself a suppression
// marker (stacked bare mutes don't justify each other).
function explainedByLineAbove(prevLine) {
  const t = prevLine.trim();
  if (!/^(\/\/|#|\*|\/\*|<!--)/.test(t)) return false;
  if (!/[a-z]/i.test(t)) return false;
  return !MARKERS.some((m) => m.probe.test(t));
}

const rule = {
  id: 'warning-suppression',
  severity: 'blocking',
  description: 'A warning suppression must carry its reason at the site — inline or in the comment above, not a bare mute',
  doc: 'packs/basics/RULES.md',
  why: 'an unexplained suppression hides the signal instead of recording why the fix was rejected',

  // Check-the-world, not check-the-work: a suppression marker is a repo-state
  // property, so scan every line of every in-scope file (the whole repo under the
  // engine's default `all` sweep), not just lines this change added. A suppression
  // that documents *why* it exists — inline or in the comment immediately above —
  // is the deliberate, reviewed decision the rule asks for, so it passes. A bare
  // marker still fires; a project deliberately keeping one it can't annotate uses an
  // `accept` entry in .claudinite-checks.json (reason required).
  run(ctx) {
    const out = [];
    // ctx.files already excludes vendored/generated files (recorded fixtures,
    // machine-written output) — a marker inside those isn't the project's suppression
    // decision, so the engine drops them from the sweep for every check.
    for (const file of ctx.files) {
      // Markers are only live in code — a doc *discussing* them isn't suppressing anything.
      if (file.endsWith('.md')) continue;
      // Pack check modules spell these markers as detection patterns; the engine's
      // tests spell them as fixtures. Neither is a live suppression. Under a full
      // sweep these skips are load-bearing (in consuming repos the mounted corpus
      // is gitignored/submodule and never in ctx.files, so they only fire here).
      // A consumer's own local-pack check layer is the same case: a rule module or
      // a bundled skill's checks.mjs under .claudinite/local/packs/ (or the
      // pre-rename .claudinite/local_packs/) spells markers as detection patterns
      // too (its run_daily scripts are NOT exempt — they are ordinary code). This
      // mirrors the packs/ skip for a project's own packs.
      if (
        /^packs\//.test(file) ||
        /(^|\/)checks\/test\//.test(file) ||
        /^\.claudinite\/local(?:\/packs|_packs)\/[^/]+\/([^/]+\.mjs|skills\/[^/]+\/checks\.mjs)$/.test(file)
      ) continue;
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      lines.forEach((lineText, i) => {
        const entry = MARKERS.find((m) => m.probe.test(lineText));
        if (!entry) return;
        const explainedInline = !entry.bare.test(lineText);
        const explainedAbove = i > 0 && explainedByLineAbove(lines[i - 1]);
        if (explainedInline || explainedAbove) return;
        out.push(finding(rule, {
          file, line: i + 1,
          what: `carries a warning-suppression marker with no reason at the site: ${lineText.trim()}`,
          fix: 'explain it where it lives — add the reason on the suppression line or in the comment immediately above it, so the suppression documents why the fix was rejected; better still, fix the underlying cause so no suppression is needed. If it genuinely can\'t be annotated, accept it in .claudinite-checks.json with a reason',
        }));
      });
    }
    return out;
  },
};

export default rule;
