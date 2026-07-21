import { posix } from 'node:path';

// The corpus's import-surface facts, in one home: how to find a module file's
// relative import specifiers, how to resolve one against a known file set
// (tree-oracle style, like the reference resolution the checks already use),
// and which paths form the ENGINE SURFACE — the always-vendored core every
// consumer carries whatever packs it declares. The vendor writer's coherence
// guard judges against these definitions; the `pack-independence` barrier
// (packs may import only their own files and this surface — barriers config
// contributed by the canon home's curation local pack) states the same surface
// as its allow list, so "what a pack may import" and "what a vendor set must
// carry" stay one idea with the barrier failing closed on any drift.

// The one root that vendors wholesale into every consumer (vendoring/DESIGN.md):
// the whole engine — hooks, loaders, checks helpers, the mount machinery — lives
// under engine/, so "engine surface" and "always vendored" are the same test.
export const ENGINE_DIR_ROOTS = ['engine'];

// Is this canon-relative path part of the engine surface?
export const engineSurface = (path) =>
  ENGINE_DIR_ROOTS.some((r) => path.startsWith(`${r}/`));

// Relative import specifiers in ES module source: `from '<spec>'`, side-effect
// `import '<spec>'`, and dynamic `import('<spec>')`. Bare specifiers (node
// builtins, dependencies) are not relative and never matched. Scanning raw
// source is deliberate — no corpus .mjs carries a relative specifier inside a
// comment or string that isn't a real module edge, and a parser would be the
// kind of dependency the engine refuses to earn.
const RELATIVE_SPEC = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.[^'"]+)['"]/g;

// Each { spec, line } in the source, 1-indexed so findings can pin the import.
export function relativeImports(source) {
  const out = [];
  for (const m of source.matchAll(RELATIVE_SPEC)) {
    out.push({ spec: m[1], line: source.slice(0, m.index).split('\n').length });
  }
  return out;
}

// Resolve a relative specifier from a repo-relative file to a repo-relative
// target, against a membership oracle `has(path)` (a tracked-file set, or the
// canon tree). Extension/index completion mirrors what Node itself would try
// for the corpus's module shapes. Returns null when nothing matches — the
// caller decides whether that is ignorable (a checker avoiding false
// positives) or fatal (a vendor set that would not load).
export function resolveRelative(fromFile, spec, has) {
  const base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  const candidates = /\.[a-z]+$/i.test(base)
    ? [base]
    : [base, `${base}.mjs`, `${base}.js`, `${base}/index.mjs`];
  return candidates.find(has) ?? null;
}
