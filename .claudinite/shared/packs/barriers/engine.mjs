import { finding } from '../../engine/checks/helpers/findings.mjs';
import { normPrefix, under } from '../../engine/checks/helpers/path-containment.mjs';

// The barriers detection engine — language-agnostic enforcement of a directed
// folder-access graph. A *barrier edge* forbids the files under one set of
// folders (`from`) from referencing another (`to`); the engine finds every
// crossing reference.
//
// The one idea that keeps it precise and technology-agnostic: **the repo tree is
// the oracle.** A candidate reference (an import specifier, a path in a comment, a
// bare filename) only counts when it *resolves to a real tracked path* inside the
// barred folder. An English word that merely happens to be a folder's name never
// resolves, so it never fires — no per-language parser, no allowlist of file
// types, and near-zero false positives. See packs/barriers/README.md, including
// its "Known limitations" section for the reference forms this does not resolve.
// (One deliberate exception: with `matchNames: true` an edge opts into matching
// the bare *names* of its barred folders — restricted to distinctive names so
// prose can't false-positive; see the names layer below.)
//
// A rule owns its exceptions. Each `except` entry is either a structural
// carve-out (a folder/glob/pattern string that removes files from the guarded
// region — the `from: "."` helper) or a reviewed exception ({ path, to?, reason }
// — a specific file's deliberate crossing, staleness-audited when `to` is pinned).
//
// Composition happens through DECLARATION, never through importing this module
// from another pack (pack-independence): a pack that wants a fixed barrier
// `requires` this pack and carries the barrier as data on its manifest
// (`contributes` — see contributed.mjs, which builds the rule from that data).
// The exports here serve this pack's own modules; the path-prefix primitives
// (`normPrefix`, `under`) live in the engine lib (engine/checks/helpers/path-containment.mjs) and are
// re-exported for them.

export const DEFAULT_DOC = 'packs/barriers/README.md';

// Test files are out of scope by nature: a test references what it tests, so a
// core test naming pack/skill content is expected, not a coupling. The engine
// never scans them — the project doesn't carve them out rule by rule.
const isTestFile = (f) => /\.test\.[cm]?js$/.test(f);

// --- path helpers (posix; both separators accepted on input) ----------------

// The prefix primitives (`normPrefix` — a folder/target prefix as the config
// author wrote it → a bare posix prefix; `under` — containment) come from the
// engine lib, re-exported for this pack's own modules and tests.
export { normPrefix, under };

// Join `rel` onto `base` and resolve "." / ".." segments, posix-style. Returns
// null when the path escapes the repo root (a leading "..") — such a reference
// points outside the tree and is not resolvable here.
function normJoin(base, rel) {
  const parts = (base ? base.split('/') : []).concat(rel.split('/'));
  const out = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else return null; // escaped the repo root
    } else out.push(seg);
  }
  return out.join('/');
}

const isGlob = (t) => t.endsWith('/*') && !t.startsWith('*.');
const globPrefix = (t) => t.slice(0, -2);

// A carve-out entry (folder/file, "<folder>/*" child-dir glob, or "*.suffix" name
// pattern) matches a path when the path is the entry / under it, or its NAME ends
// with the pattern's suffix. "<dir>/*" globs are expanded to concrete child
// directories before this runs, so only the two plain forms reach here.
function carveMatch(path, carve) {
  for (const e of carve) {
    if (e.startsWith('*.')) {
      const base = path.slice(path.lastIndexOf('/') + 1);
      if (base.endsWith(e.slice(1))) return true;
    } else if (under(path, e)) return true;
  }
  return false;
}

// Does one carve-out entry fully cover a barred target, so validation can prove
// the target lies outside a root-guarded region? Name patterns never cover a folder.
function carveCovers(e, t) {
  if (e.startsWith('*.')) return false;
  const tp = isGlob(t) ? globPrefix(t) : t;
  if (!isGlob(e)) return under(tp, e);
  return isGlob(t) ? under(tp, globPrefix(e)) : under(tp, globPrefix(e)) && tp !== globPrefix(e);
}

// A bare filename carries an extension. The cap tolerates long real suffixes
// (`.properties`, `.stylesheet`) while still requiring a letter-led extension.
const hasExt = (base) => /\.[A-Za-z][A-Za-z0-9]{0,19}$/.test(base);

// Extension/index completion, for extension-less import specifiers (`../server/db`
// → server/db.ts) and directory imports (`../server` → server/index.ts). Applied
// only to slash-based path attempts — NOT to the dotted-module conversion, which
// completes with Python extensions alone (see resolveRef).
const TRY_EXT = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.py', '.go', '.rb', '.java', '.rs', '.php', '.html', '.vue', '.svelte'];
const TRY_INDEX = ['/index.js', '/index.mjs', '/index.ts', '/index.tsx', '/index.jsx'];

// --- repo index (built once per run) ----------------------------------------

// Every known path, every directory prefix, and a basename→paths map (for the
// unique-filename layer). Built from ctx.tracked PLUS the in-scope untracked
// set (ctx.allFiles), so a reference resolves against everything the repo
// knows — a Stop-hook run routinely sees fresh files before their first
// `git add`, and an import of (or a sibling directory made of) untracked
// files must guard exactly like a tracked one.
export function buildIndex(ctx) {
  const files = new Set();
  const dirs = new Set();
  const byBase = new Map();
  for (const raw of new Set([...ctx.tracked, ...(ctx.allFiles ?? [])])) {
    const f = raw.replace(/\\/g, '/');
    files.add(f);
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    const base = parts[parts.length - 1];
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }
  return { files, dirs, byBase };
}

// Does `p` name a real tracked file or directory (allowing extension/index and
// Sass-partial completion)? Returns the concrete resolved path, or null.
function matchTree(p, index) {
  if (!p) return null;
  if (index.files.has(p)) return p;
  if (index.dirs.has(p)) return p;
  for (const ext of TRY_EXT) if (index.files.has(p + ext)) return p + ext;
  for (const idx of TRY_INDEX) if (index.files.has(p + idx)) return p + idx;
  // Sass/SCSS underscore partials: dir/name → dir/_name.scss (imported without the _).
  const slash = p.lastIndexOf('/');
  const partial = `${p.slice(0, slash + 1)}_${p.slice(slash + 1)}`;
  for (const ext of ['.scss', '.sass']) if (index.files.has(partial + ext)) return partial + ext;
  return null;
}

// --- candidate extraction ---------------------------------------------------

// Quoted string contents (import specifiers, require paths, config values, JSON).
const QUOTED = /'([^'\n]+)'|"([^"\n]+)"|`([^`\n]+)`/g;
// Unquoted path-ish tokens (comments, Markdown, plain prose): a relative path, a
// multi-segment slash path, or a bare filename that carries an extension.
const PATHISH = /(?:\.{1,2}[\\/])[\w.@+\-\\/]+|[\w@+\-][\w.@+\-]*(?:[\\/][\w.@+\-]+)+|[\w@+\-][\w.@+\-]*\.[A-Za-z][A-Za-z0-9]{0,19}/g;
const URLISH = /^(?:[a-z][a-z0-9+.\-]*:)?\/\//i; // http://, https://, //cdn, mailto: handled below

// Code files an imports-scoped edge scans — the module formats whose
// import/require specifiers are runtime edges.
const CODE_FILE = /\.(?:mjs|cjs|jsx?|mts|cts|tsx?)$/;

// RELATIVE import/require specifiers across the WHOLE source — `from '<spec>'`,
// side-effect `import '<spec>'`, dynamic `import('<spec>')`, `require('<spec>')`
// — the `scope: "imports"` extractor. Whole-source (not per-line), so an import
// broken across lines still counts; only '.'-led specifiers, because bare and
// root-relative strings are never module edges (mirroring the old
// pack-independence extractor, engine/checks/helpers/module-imports.mjs RELATIVE_SPEC) — which is
// also what keeps prose quoting a repo path after the word "from" from firing.
// Each hit carries the 1-indexed line of the specifier itself.
const IMPORT_SPEC = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"`](\.[^'"`\n]+)['"`]/g;
export function importSpecifiers(source) {
  const out = [];
  for (const m of source.matchAll(IMPORT_SPEC)) {
    out.push({ spec: m[1], line: source.slice(0, m.index + m[0].indexOf(m[1])).split('\n').length });
  }
  return out;
}

// Resolve one relative import specifier file-relatively, completing extensions
// and index files but never matching a bare directory: a directory with no
// index module is unloadable — breakage, not a boundary crossing — and the
// fuzzy layers (repo-root retry, dotted modules, unique basenames) have no
// place in module resolution. Mirrors the old pack-independence resolution.
export function resolveImport(spec, fromDir, index) {
  const p = normJoin(fromDir, spec.replace(/\\/g, '/'));
  if (!p) return null;
  if (index.files.has(p)) return p;
  for (const ext of TRY_EXT) if (index.files.has(p + ext)) return p + ext;
  for (const idx of TRY_INDEX) if (index.files.has(p + idx)) return p + idx;
  return null;
}

// Every reference candidate on one line, de-duplicated, cleaned of wrapping
// punctuation, URLs and query/hash tails dropped.
export function candidatesOn(line) {
  const raw = new Set();
  let m;
  QUOTED.lastIndex = 0;
  while ((m = QUOTED.exec(line)) !== null) raw.add(m[1] ?? m[2] ?? m[3]);
  PATHISH.lastIndex = 0;
  while ((m = PATHISH.exec(line)) !== null) raw.add(m[0]);

  const out = new Set();
  for (let c of raw) {
    c = c.trim().replace(/[?#].*$/, ''); // drop query string / anchor
    c = c.replace(/^[([{<'"`]+/, '').replace(/[)\]}>'"`.,;:]+$/, ''); // wrapping punctuation
    if (!c) continue;
    if (URLISH.test(c) || c.startsWith('mailto:')) continue;
    out.add(c);
  }
  return [...out];
}

// Resolve one candidate string, seen in a file whose directory is `fromDir`, to a
// concrete tracked path — or null when it names nothing in the repo. Tries, in
// order: file-relative, repo-root-relative, Python-style dotted module, and the
// unique-basename layer (a bare `name.ext` that exactly one tracked file carries).
// `matchUniqueFilenames` gates that last, fuzziest layer: with it off, a bare
// filename resolves only through the path attempts, so a *convention* marker
// (a filename many folders are meant to carry but only one does yet) no longer
// resolves to that lone folder — the caller opts out when that false positive
// costs more than the layer's catches (see barrierFindings / the README caveat).
export function resolveRef(candidate, fromDir, index, matchUniqueFilenames = true) {
  const c = candidate.replace(/\\/g, '/');
  const attempts = [];

  if (c.startsWith('./') || c.startsWith('../')) {
    attempts.push(normJoin(fromDir, c));
  } else if (c.startsWith('/')) {
    attempts.push(normJoin('', c.slice(1)));
  } else {
    // File-relative first: a local reference that stays within `from` resolves
    // here and is (correctly) not a crossing — preferring it over the repo-root
    // interpretation avoids a false crossing when both paths happen to exist.
    attempts.push(normJoin(fromDir, c));
    if (c.includes('/')) attempts.push(normJoin('', c)); // repo-root relative
  }
  for (const p of attempts) {
    const hit = matchTree(p, index);
    if (hit) return hit;
  }

  // Python-style dotted module: a.b.c → a/b/c, completed with PYTHON extensions
  // ONLY. JS/TS/… never address modules with dots — there a `receiver.method()`
  // call is member access, not a module path — so restricting completion to
  // `.py`/`__init__.py` keeps the tree from fabricating a `db/query.js` match for
  // a `db.query(...)` call. The genuinely-ambiguous Python case still resolves.
  if (!c.includes('/') && c.includes('.') && /^[A-Za-z_][\w.]*[A-Za-z0-9_]$/.test(c)) {
    const d = normJoin('', c.replace(/\./g, '/'));
    if (d) {
      if (index.files.has(d)) return d;
      if (index.dirs.has(d)) return d;
      if (index.files.has(`${d}.py`)) return `${d}.py`;
      if (index.files.has(`${d}/__init__.py`)) return `${d}/__init__.py`;
    }
  }

  // Unique filename-with-extension: a bare `tokenStore.ts` mentioned anywhere
  // resolves only when exactly one tracked file carries that basename (no
  // collision → no false positive). The owner-scoped filename layer, opt-out.
  if (matchUniqueFilenames && !c.includes('/') && hasExt(c)) {
    const paths = index.byBase.get(c);
    if (paths && paths.length === 1) return paths[0];
  }
  return null;
}

// --- field parsing ----------------------------------------------------------

const EDGE_KEYS = ['from', 'to', 'between', 'siblings', 'scope', 'allow', 'except', 'matchNames', 'alsoMatchNames', 'matchUniqueFilenames', 'reason'];
const EXCEPTION_KEYS = ['path', 'to', 'reason'];

// `from`: a string or an array of them → a list of normalized prefixes. "." is
// the repo root (""); every other entry must name a real folder/file, no
// wildcards. Errors are pushed; returns null on any problem.
function parseFrom(raw, at, errors) {
  const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : null;
  if (list === null || !list.length || list.some((f) => typeof f !== 'string' || !f.trim())) {
    errors.push({ what: `${at} needs a "from" folder (or an array of them), and a "to"`, fix: 'add "from": "checks" or "from": ["checks", "growth"], and a "to"' });
    return null;
  }
  const out = [];
  for (const f of list) {
    if (f.includes('*')) {
      errors.push({ what: `${at}: "from" entry "${f}" cannot contain a wildcard`, fix: 'name a real folder/file, e.g. "checks" — or "." for the repo root' });
      return null;
    }
    const p = normPrefix(f);
    if (p === '' && f.trim() !== '.') {
      errors.push({ what: `${at}: "from" entry "${f}" must name a real folder/file, or "." for the repo root`, fix: 'name the folder to guard, or write "." explicitly for the whole repo' });
      return null;
    }
    out.push(p);
  }
  return out;
}

// Split a rule's `except` array into structural carve-outs (strings) and reviewed
// exceptions (objects). A carve-out is a folder/file, a "<folder>/*" child-dir
// glob, or a "*.suffix" name pattern — it removes matching files from the guarded
// region (the `from: "."` helper). A reviewed exception { path, to?, reason }
// excuses one file's crossings: to a pinned barred folder (staleness-audited), or
// — with no `to` — every crossing from that file (a whole-file carve-out that,
// unlike a bare string, carries a reason). Errors pushed; returns null on any.
function parseExcept(raw, at, errors) {
  const carve = [];
  const exceptions = [];
  if (raw === undefined) return { carve, exceptions };
  const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : null;
  if (list === null) {
    errors.push({ what: `${at}: "except" must be an array (carve-out strings and/or { path, to?, reason } exceptions)`, fix: 'use "except": ["vendor", { "path": "src/bridge.js", "to": "server", "reason": "…" }]' });
    return null;
  }
  for (const e of list) {
    if (typeof e === 'string') {
      const s = e.replace(/\\/g, '/');
      if (s.startsWith('*.')) {
        if (s.length < 3 || s.slice(1).includes('/') || s.slice(2).includes('*')) {
          errors.push({ what: `${at}: pattern "${e}" is not a "*.suffix" name pattern`, fix: 'a pattern entry is "*." plus a name suffix, e.g. "*.stories.js"' });
          return null;
        }
        carve.push(s);
        continue;
      }
      const p = normPrefix(s.endsWith('/*') ? s.slice(0, -2) : s);
      if (p === '' || p.includes('*')) {
        errors.push({ what: `${at}: carve-out "${e}" must name a folder/file, a "<folder>/*" glob, or a "*.suffix" pattern`, fix: 'remove the empty/malformed entry — an empty one would carve out everything' });
        return null;
      }
      carve.push(s.endsWith('/*') ? `${p}/*` : p);
      continue;
    }
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      errors.push({ what: `${at}: an "except" entry must be a carve-out string or a { path, to?, reason } object`, fix: 'use a folder string or { "path": "…", "to": "…", "reason": "…" }' });
      return null;
    }
    const unknown = Object.keys(e).filter((k) => !EXCEPTION_KEYS.includes(k));
    if (unknown.length) {
      errors.push({ what: `${at}: exception has unknown ${unknown.length > 1 ? 'properties' : 'property'} ${unknown.map((k) => `"${k}"`).join(', ')}`, fix: `an exception takes only: ${EXCEPTION_KEYS.join(', ')}` });
      return null;
    }
    if (typeof e.path !== 'string' || !e.path.trim()) {
      errors.push({ what: `${at}: an exception needs a string "path"`, fix: 'name the file with the deliberate crossing (or a subtree with a trailing "/")' });
      return null;
    }
    let to = null;
    if (e.to !== undefined) {
      const toList = typeof e.to === 'string' ? [e.to] : Array.isArray(e.to) ? e.to : null;
      if (toList === null || !toList.length || toList.some((t) => typeof t !== 'string' || !normPrefix(t) || t.includes('*'))) {
        errors.push({ what: `${at}: exception "${e.path}" has a malformed "to"`, fix: 'omit "to" to excuse the whole file, or name the barred folder(s) it may reference — no wildcards' });
        return null;
      }
      to = toList.map(normPrefix);
    }
    if (typeof e.reason !== 'string' || !e.reason.trim()) {
      errors.push({ what: `${at}: exception "${e.path}" has no reason`, fix: 'add a non-empty "reason" — the reason string is what makes an accepted crossing reviewable' });
      return null;
    }
    exceptions.push({ path: e.path.replace(/\\/g, '/'), to, reason: e.reason });
  }
  return { carve, exceptions };
}

// --- edge normalization -----------------------------------------------------

// A single normalized edge's shape problem, or null if it is well-formed. The
// invariant it proves: no barred target is swallowed by the guard — a target must
// not sit inside a `from` folder (it would never be flagged), and a `from` folder
// must not sit inside a target (its own references would be self-refs). A `from`
// that is the repo root ("") needs the target carved out instead.
function edgeProblem(edge, at) {
  const root = edge.froms.includes('');
  if (edge.allow.some((a) => a === '' || a.includes('*'))) {
    return { what: `${at}: every "allow" entry must name a real folder`, fix: 'remove the empty/wildcard allow entry (it would disable or no-op the barrier), or name a shared folder' };
  }
  for (const t of edge.targets) {
    if (t === '*') {
      if (root) return { what: `${at}: isolating the repo root is meaningless`, fix: 'name the folder to isolate — everything is already inside the repo root' };
      if (edge.matchNames) return { what: `${at}: "matchNames" needs named "to" folders`, fix: 'drop "matchNames": true, or bar concrete folders instead of "*"' };
      continue;
    }
    const glob = isGlob(t);
    const tp = glob ? globPrefix(t) : t;
    if (root && !edge.carve.some((e) => carveCovers(e, t))) {
      return {
        what: `${at}: "to" (${t}) overlaps the repo-root guard — the self-reference rule would exempt it`,
        fix: 'add the barred folder (or its "<folder>/*" glob) to "except" so it leaves the guarded region, or guard specific folders instead of "."',
      };
    }
    for (const fp of edge.froms) {
      if (fp === '') continue; // root handled above
      // A glob target bars only the CHILD DIRECTORIES of its prefix, so a `from`
      // that is a specific file/dir *inside* that prefix (an engine file living
      // among content, or one sibling guarded against the others) is fine — only
      // a `from` that IS the glob prefix (or an ancestor of it) swallows the
      // children as self-refs. A plain target overlaps on any nesting either way.
      const overlap = glob
        ? fp === tp || under(tp, fp)
        : fp === t || under(t, fp) || under(fp, t);
      if (overlap) {
        return { what: `${at}: "from" (${fp}) and "to" (${tp}) overlap`, fix: 'a folder cannot be barred from itself or an ancestor — pick disjoint folders' };
      }
    }
  }
  return null;
}

// Turn author-written barrier specs into normalized edges, collecting shape
// errors as { what, fix } for the caller to surface as blocking findings.
//   { from, to, allow?, except?, matchNames?, alsoMatchNames?, reason? }  one directed ban
//   { between: [a, b], ... }             sugar → both directions
//   { siblings: "<folder>", to, ... }    each direct child directory of <folder>
//       guarded in turn (expanded structurally at scan time, fail-closed when
//       the folder has no tracked child directories) — `to: "<folder>/*"` gives
//       mutual sibling separation (a child's own files stay open via the
//       self-reference rule), `to: "*"` per-child isolation with an allow list
//   from: a folder/file, "." (the repo root), or an array of folders/files
//   to: a folder, "<folder>/*" (every direct child directory), "*" (isolation:
//       `from` may reference nothing outside itself/allow), or an array of the
//       folder/glob forms
//   scope: "imports" restricts the edge to RELATIVE import/require specifiers
//       in code files, resolved as module edges — no bare/root-relative
//       strings, no fuzzy layers, an index-less directory import is breakage
//       not a crossing — so prose, docs, and comments stay free to mention (or
//       quote paths into) the barred folders; default is every resolvable
//       reference. Incompatible with matchNames (a text layer).
//   allow: a shared folder (or array) reachable despite the ban
//   except: carve-out strings (folders/globs/patterns — the `from: "."` helper)
//       and/or reviewed exceptions { path, to?, reason } (a file's deliberate
//       crossing — to pinned folders, or the whole file when `to` is omitted)
//   matchNames: true opts into the bare-name layer; alsoMatchNames force-includes
//       non-distinctive barred-folder names (see barrierFindings)
export function normalizeEdges(specs) {
  const edges = [];
  const errors = [];
  if (!Array.isArray(specs)) {
    return { edges, errors: [{ what: 'barrier rules must be an array', fix: 'set "rules" to an array of barrier entries' }] };
  }
  specs.forEach((spec, i) => {
    const at = `barrier rule #${i + 1}`;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      errors.push({ what: `${at} must be an object`, fix: 'use { "from": "...", "to": "..." } or { "between": ["a","b"] }' });
      return;
    }
    const unknown = Object.keys(spec).filter((k) => !EDGE_KEYS.includes(k));
    if (unknown.length) {
      errors.push({ what: `${at} has unknown ${unknown.length > 1 ? 'properties' : 'property'} ${unknown.map((k) => `"${k}"`).join(', ')}`, fix: `a barrier rule takes only: ${EDGE_KEYS.join(', ')}` });
      return;
    }

    // allow: a string is single-folder shorthand.
    let allow;
    if (spec.allow === undefined) allow = [];
    else if (typeof spec.allow === 'string') allow = [spec.allow];
    else if (Array.isArray(spec.allow) && spec.allow.every((a) => typeof a === 'string')) allow = spec.allow;
    else { errors.push({ what: `${at}: "allow" must be a folder path or an array of them`, fix: 'use "allow": "shared" or "allow": ["shared", "contracts"]' }); return; }
    allow = allow.map(normPrefix);

    const parsedExcept = parseExcept(spec.except, at, errors);
    if (parsedExcept === null) return;
    const { carve, exceptions } = parsedExcept;

    if (spec.matchNames !== undefined && typeof spec.matchNames !== 'boolean') {
      errors.push({ what: `${at}: "matchNames" must be true or false`, fix: 'set "matchNames": true to also match the bare names of barred folders' });
      return;
    }
    const matchNames = spec.matchNames === true;
    let alsoMatchNames;
    if (spec.alsoMatchNames === undefined) alsoMatchNames = [];
    else if (typeof spec.alsoMatchNames === 'string') alsoMatchNames = [spec.alsoMatchNames];
    else if (Array.isArray(spec.alsoMatchNames) && spec.alsoMatchNames.every((n) => typeof n === 'string')) alsoMatchNames = spec.alsoMatchNames;
    else { errors.push({ what: `${at}: "alsoMatchNames" must be a bare folder name or an array of them`, fix: 'use "alsoMatchNames": ["someword"] — bare folder names, no paths' }); return; }
    if (alsoMatchNames.some((n) => !n.trim() || /[\\/*]/.test(n))) {
      errors.push({ what: `${at}: every "alsoMatchNames" entry must be a bare folder name`, fix: 'name the barred folder itself (its last path segment), without separators or wildcards' });
      return;
    }
    if (alsoMatchNames.length && !matchNames) {
      errors.push({ what: `${at}: "alsoMatchNames" requires "matchNames": true`, fix: 'set "matchNames": true — alsoMatchNames only extends the bare-name layer' });
      return;
    }
    if (spec.matchUniqueFilenames !== undefined && typeof spec.matchUniqueFilenames !== 'boolean') {
      errors.push({ what: `${at}: "matchUniqueFilenames" must be true or false`, fix: 'set "matchUniqueFilenames": false to stop resolving a bare filename that only one folder carries (a convention marker)' });
      return;
    }
    const matchUniqueFilenames = spec.matchUniqueFilenames !== false;

    if (spec.scope !== undefined && spec.scope !== 'imports' && spec.scope !== 'all') {
      errors.push({ what: `${at}: "scope" must be "imports" or "all"`, fix: 'set "scope": "imports" to match only import/require specifiers in code files, or drop it for every resolvable reference' });
      return;
    }
    const scope = spec.scope === 'imports' ? 'imports' : 'all';
    if (scope === 'imports' && matchNames) {
      errors.push({ what: `${at}: "matchNames" cannot combine with "scope": "imports"`, fix: 'the names layer matches arbitrary text, which an imports-scoped edge excludes by definition — drop one of the two' });
      return;
    }

    let siblings = null;
    if (spec.siblings !== undefined) {
      if (typeof spec.siblings !== 'string' || !spec.siblings.trim() || spec.siblings.includes('*')) {
        errors.push({ what: `${at}: "siblings" must name a real folder`, fix: 'use "siblings": "<folder>" — each of its direct child directories is guarded in turn; no wildcards' });
        return;
      }
      if (spec.from !== undefined || spec.between !== undefined) {
        errors.push({ what: `${at}: "siblings" cannot combine with "from" or "between"`, fix: 'a siblings edge derives its guarded folders from the named folder\'s children — drop "from"/"between", or drop "siblings"' });
        return;
      }
      siblings = normPrefix(spec.siblings);
      if (siblings === '') {
        errors.push({ what: `${at}: "siblings" must name a real subfolder, not the repo root`, fix: 'name the folder whose child directories should be mutually guarded' });
        return;
      }
    }

    const reason = typeof spec.reason === 'string' ? spec.reason : null;

    // Normalize one to-entry: '*', '<folder>/*', or a folder prefix. Null = error.
    const parseTarget = (t) => {
      if (t === '*') return '*';
      const s = t.replace(/\\/g, '/');
      const glob = s.endsWith('/*');
      const p = normPrefix(glob ? s.slice(0, -2) : s);
      if (p === '' || p.includes('*')) {
        errors.push({ what: `${at}: "to" must name a real subfolder, a "<folder>/*" glob, or "*"`, fix: 'name the barred folder, "<folder>/*" for its child directories, or "*" for isolation' });
        return null;
      }
      return glob ? `${p}/*` : p;
    };

    const mk = (froms, targets) => ({ froms, targets, siblings, scope, allow, carve, exceptions, matchNames, alsoMatchNames, matchUniqueFilenames, reason });

    if (Array.isArray(spec.between)) {
      if (spec.between.length !== 2 || spec.between.some((s) => typeof s !== 'string' || !s.trim() || s.includes('*'))) {
        errors.push({ what: `${at} "between" must be two folder paths`, fix: 'use "between": ["clientDir", "serverDir"] — no wildcards' });
        return;
      }
      const [a, b] = spec.between.map(normPrefix);
      if (a === '' || b === '') {
        errors.push({ what: `${at} "between" must name real subfolders`, fix: 'use "between": ["clientDir", "serverDir"] (not "", ".", or "/")' });
        return;
      }
      const e1 = mk([a], [b]);
      const e2 = mk([b], [a]);
      const prob = edgeProblem(e1, at) || edgeProblem(e2, at);
      if (prob) { errors.push(prob); return; }
      edges.push(e1, e2);
      return;
    }

    // A siblings edge derives its guarded folders structurally at scan time
    // (each direct child of the named folder in turn), so it carries no froms
    // here — barrierFindings expands it against the real tree, fail-closed.
    const froms = siblings ? [] : parseFrom(spec.from, at, errors);
    if (froms === null) return;
    const toRaw = typeof spec.to === 'string' && spec.to.trim() ? [spec.to]
      : Array.isArray(spec.to) && spec.to.length && spec.to.every((t) => typeof t === 'string' && t.trim()) ? spec.to
        : null;
    if (toRaw === null) {
      errors.push({ what: `${at} needs a "to" folder path (or an array of them), or a "between" pair`, fix: 'add a "to" folder path, or use "between": [a, b]' });
      return;
    }
    const targets = toRaw.map(parseTarget);
    if (targets.includes(null)) return;
    if (targets.includes('*') && targets.length > 1) {
      errors.push({ what: `${at}: "*" cannot be combined with other "to" entries`, fix: 'isolation ("*") already bars everything — drop the other entries or the "*"' });
      return;
    }
    const edge = mk(froms, targets);
    const prob = edgeProblem(edge, at);
    if (prob) { errors.push(prob); return; }
    edges.push(edge);
  });
  return { edges, errors };
}

// --- reviewed-exception filtering (per edge) --------------------------------

// Filter one edge's crossing findings through its reviewed exceptions. Returns
// the survivors plus the stale (path, to) pairs — exceptions that matched no
// crossing, meaning the coupling they excused is gone and the entry should be
// pruned. A `to`-less exception excuses every crossing from its file; a pinned
// one only crossings landing under a named barred folder, per to-entry.
function applyExceptions(findings, exceptions) {
  const used = exceptions.map((e) => (e.to ? e.to.map(() => false) : [false]));
  const kept = findings.filter((f) => {
    for (let i = 0; i < exceptions.length; i++) {
      const e = exceptions[i];
      if (!(e.path === f.file || (e.path.endsWith('/') && f.file.startsWith(e.path)))) continue;
      if (!e.to) { used[i][0] = true; return false; }
      for (let j = 0; j < e.to.length; j++) {
        if (under(f.resolved, e.to[j])) { used[i][j] = true; return false; }
      }
    }
    return true;
  });
  const stale = [];
  exceptions.forEach((e, i) => {
    if (!e.to) { if (!used[i][0]) stale.push({ path: e.path, to: null }); }
    else e.to.forEach((t, j) => { if (!used[i][j]) stale.push({ path: e.path, to: t }); });
  });
  return { kept, stale };
}

// --- the scan ---------------------------------------------------------------

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Run the given edges over the context. Returns { findings, stale }: the crossing
// findings that survive each edge's reviewed exceptions, plus the stale exception
// pairs the caller may surface as prune-me findings (gated on a whole-repo sweep).
// `rule` supplies id / severity / doc. Every crossing finding carries the resolved
// path as `resolved`; config-shape findings (empty glob) do not.
export function barrierFindings(ctx, edges, rule) {
  if (!edges.length) return { findings: [], stale: [] };
  const index = buildIndex(ctx);
  const scannable = ctx.files.map((f) => f.replace(/\\/g, '/')).filter((f) => !isTestFile(f));
  const out = [];
  const staleAll = [];
  const readCache = new Map();
  const read = (f) => {
    if (!readCache.has(f)) readCache.set(f, ctx.read(f));
    return readCache.get(f);
  };
  const childDirs = (p) => [...index.dirs].filter((d) => d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes('/'));

  const scanEdge = (edge) => {
    const carve = edge.carve.flatMap((e) => (isGlob(e) ? childDirs(globPrefix(e)) : [e]));
    const star = edge.targets.includes('*');
    const barred = [];
    let broken = false;
    for (const t of edge.targets) {
      if (t === '*') continue;
      if (isGlob(t)) {
        const kids = childDirs(globPrefix(t));
        if (!kids.length) {
          // Structural enumeration came up empty — fail closed, never silently
          // enforce nothing (a renamed folder must not disarm the barrier).
          out.push(specFinding(rule, {
            what: `"to" glob "${t}" matched no directories`,
            fix: 'check the folder exists and has tracked subdirectories — an empty expansion would enforce nothing',
          }));
          broken = true;
        }
        barred.push(...kids);
      } else barred.push(t);
    }
    if (broken) return;

    const inGuard = (p) => edge.froms.some((fp) => under(p, fp)) && !carveMatch(p, carve);

    // The names layer: an edge with `matchNames: true` also matches the bare
    // NAMES of its barred folders — but only distinctive ones (containing "-" or
    // "_"), which ordinary prose never produces, plus any the edge force-includes
    // via alsoMatchNames. This catches identifier-level coupling (a hardcoded
    // folder name in a string or doc) that no path ever spells out.
    let nameRe = null;
    const nameDirs = new Map();
    if (edge.matchNames) {
      const bases = new Map();
      for (const d of barred) {
        const base = d.slice(d.lastIndexOf('/') + 1);
        if (!bases.has(base)) bases.set(base, []);
        bases.get(base).push(d);
      }
      for (const [base, dirs] of bases) {
        if (/[-_]/.test(base) || edge.alsoMatchNames.includes(base)) nameDirs.set(base, dirs);
      }
      for (const n of edge.alsoMatchNames) {
        if (!bases.has(n)) {
          out.push(specFinding(rule, {
            what: `"alsoMatchNames" entry "${n}" is not the name of any barred folder`,
            fix: 'fix the name or drop the entry — it matches nothing',
          }));
        }
      }
      if (nameDirs.size) {
        nameRe = new RegExp(`(^|[^\\w./-])(${[...nameDirs.keys()].map(escRe).join('|')})(?=[^\\w./-]|$)`, 'g');
      }
    }

    const allowHint = edge.allow.length
      ? `route shared code through an allowed folder (${edge.allow.join(', ')})`
      : 'route shared code through a shared/contracts folder both sides may use';
    // A pack-shipped fixed barrier's edges are code, so "add a reviewed
    // exception" (per-rule except entries in the project's own config) cannot
    // resolve its findings — such a rule overrides the excusal clause via
    // `crossingExcuse` to point at the lever that actually works (an accept).
    const excuse = rule.crossingExcuse
      || 'add a reviewed exception in .claudinite-checks.json if the crossing is deliberate';
    const raw = [];
    const seen = new Set();
    const emit = (file, line, what, r) => {
      const key = `${file}:${line}:${r}`;
      if (seen.has(key)) return;
      seen.add(key);
      raw.push({
        ...finding(rule, {
          file,
          line,
          what,
          why: edge.reason || rule.why,
          fix: `${allowHint}, remove the reference, or ${excuse}`,
        }),
        resolved: r,
      });
    };

    // An imports-scoped edge scans only code files, and only their relative
    // import/require specifiers, resolved as module edges (resolveImport) —
    // matchNames is validated away for it, so the names layer below never arms.
    const importsOnly = edge.scope === 'imports';
    const guarded = scannable.filter((f) => inGuard(f) && (!importsOnly || CODE_FILE.test(f)));
    for (const file of guarded) {
      const text = read(file);
      if (text === null) continue;
      const fromDir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
      if (importsOnly) {
        for (const { spec, line } of importSpecifiers(text)) {
          const r = resolveImport(spec, fromDir, index);
          if (r === null || inGuard(r)) continue;
          if (edge.allow.some((a) => under(r, a))) continue;
          const t = barred.find((b) => under(r, b));
          if (star) {
            emit(file, line, `imports "${spec}" → resolves to "${r}", outside the guarded region`, r);
          } else if (t) {
            emit(file, line, `imports "${spec}" → resolves to "${r}", inside the barred folder "${t}"`, r);
          }
        }
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const rawRef of candidatesOn(lines[i])) {
          const r = resolveRef(rawRef, fromDir, index, edge.matchUniqueFilenames);
          if (r === null || inGuard(r)) continue;
          if (edge.allow.some((a) => under(r, a))) continue;
          const t = barred.find((b) => under(r, b));
          if (star) {
            emit(file, i + 1, `references "${rawRef}" → resolves to "${r}", outside the guarded region`, r);
          } else if (t) {
            emit(file, i + 1, `references "${rawRef}" → resolves to "${r}", inside the barred folder "${t}"`, r);
          }
        }
        if (nameRe) {
          nameRe.lastIndex = 0;
          let m;
          while ((m = nameRe.exec(lines[i])) !== null) {
            for (const d of nameDirs.get(m[2])) {
              if (inGuard(d) || edge.allow.some((a) => under(d, a))) continue;
              emit(file, i + 1, `mentions "${m[2]}", the name of the barred folder "${d}"`, d);
            }
          }
        }
      }
    }

    const { kept, stale } = applyExceptions(raw, edge.exceptions);
    out.push(...kept);
    staleAll.push(...stale);
  };

  for (const edge of edges) {
    // A siblings edge expands against the real tree: each direct child
    // directory of the named folder becomes the guarded `from` of its own
    // sub-edge (so a child's own files pass via the self-reference rule while
    // every sibling stays barred). Fail closed on an empty expansion — a
    // renamed folder must not silently disarm the barrier.
    if (edge.siblings) {
      const kids = childDirs(edge.siblings);
      if (!kids.length) {
        out.push(specFinding(rule, {
          what: `"siblings" folder "${edge.siblings}" has no tracked child directories`,
          fix: 'check the folder exists and has tracked subdirectories — an empty expansion would enforce nothing',
        }));
        continue;
      }
      for (const kid of kids) scanEdge({ ...edge, froms: [kid] });
      continue;
    }
    scanEdge(edge);
  }
  return { findings: out, stale: staleAll };
}

// Emit a spec/shape error as a blocking finding pinned at the settings file.
export function specFinding(rule, { what, fix }) {
  return finding(rule, {
    file: '.claudinite-checks.json',
    line: null,
    what: `barriers config: ${what}`,
    why: 'a malformed barrier declaration silently enforces nothing',
    fix,
    severity: 'blocking',
  });
}

// A stale reviewed exception (it matched no crossing) means the coupling it
// excused is gone — surface it so paid-down debt gets pruned. Judged only by the
// caller on a whole-repo sweep with a clean config (a --changed run sees only
// part of the findings; a config error means the scan itself was incomplete).
export function staleFindings(stale, rule) {
  return stale.map((s) => specFinding(rule, {
    what: `exception for "${s.path}"${s.to ? ` → "${s.to}"` : ''} matched nothing — the coupling it excused is gone`,
    fix: `remove the stale exception${s.to ? ' (or the stale "to" item)' : ''} from the rule's "except"`,
  }));
}

