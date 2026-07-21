import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPacks, resolveDeclaredPacks, packEntryId, SHARED_SUBDIR } from '../packs/registry.mjs';
import { relativeImports, resolveRelative, ENGINE_DIR_ROOTS, MACHINERY_ROOTS } from '../checks/lib/imports.mjs';

// The vendor-set computation for the vendored mount (DESIGN.md): given a repo's
// pack declaration, the minimal corpus file set that repo persists under
// SHARED_SUBDIR — canon-relative paths, mirroring exactly what a future
// submodule mounted at that same root would place there. Always computed
// against the canon tree THIS module ships in — the nightly runs it from the
// home checkout, an on-demand refresh from the tree it just fetched — so the
// set and the content can never come from different snapshots.
const canonRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Re-exported for the writers (the nightly update pass, an on-demand refresh):
// the consumer-side root the set materializes under.
export { SHARED_SUBDIR };

// The corpus index a consumer imports from its own CLAUDE.md.
export const INDEX_FILE = 'CLAUDE.md';

// The engine is discovered structurally, never listed file-by-file: the engine
// roots vendor wholesale (a new engine file ships with no edit here) and the
// machinery roots contribute their top-level non-test .mjs. Both lists live in
// the engine lib (checks/lib/imports.mjs) — the same surface the
// pack-independence barrier confines pack imports to, so "what a pack may import"
// and "what every consumer carries" can never drift apart — re-exported here
// as the vendor-set contract (DESIGN.md). Excluded within the engine roots:
// tests (*.test.mjs and test/ directories) and *.md — docs at the engine
// roots are canon-maintainer reference, read upstream when needed, while a
// pack's or skill's .md files are the payload and ride their own directories
// below.
export { ENGINE_DIR_ROOTS, MACHINERY_ROOTS };

const isTest = (name) => name.endsWith('.test.mjs');

function walk(relDir, files, errors, { engine = false } = {}) {
  let entries;
  try {
    entries = readdirSync(join(canonRoot, relDir), { withFileTypes: true });
  } catch (e) {
    errors.push({
      what: `${relDir} is not a readable directory in the canon tree: ${e.message}`,
      fix: `restore ${relDir}, or fix what names it (an engine root, a pack.mjs skills list)`,
    });
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (engine && entry.name === 'test') continue;
      walk(`${relDir}/${entry.name}`, files, errors, { engine });
    } else if (!isTest(entry.name) && !(engine && entry.name.endsWith('.md'))) {
      files.add(`${relDir}/${entry.name}`);
    }
  }
}

// declaredEntries: the raw `packs` array from .claudinite-checks.json (id
// strings and/or entry objects). extraSkills: skills the canon can't derive —
// e.g. ones a member's own local packs require. Returns { files, errors }:
// sorted canon-relative paths, and { what, fix } diagnostics. Ids naming no
// canon pack (a consumer's local packs, or a typo the runner's settings
// validation already flags) are skipped without error; per-user preferences
// are deliberately absent — they are never vendored (DESIGN.md).
export async function computeVendorSet(declaredEntries, { extraSkills = [] } = {}) {
  const files = new Set();
  const errors = [];

  if (existsSync(join(canonRoot, INDEX_FILE))) files.add(INDEX_FILE);
  else errors.push({ what: `${INDEX_FILE} is missing from the canon tree`, fix: 'restore the corpus index' });
  for (const root of ENGINE_DIR_ROOTS) walk(root, files, errors, { engine: true });
  for (const root of MACHINERY_ROOTS) {
    let entries;
    try {
      entries = readdirSync(join(canonRoot, root), { withFileTypes: true });
    } catch (e) {
      errors.push({ what: `${root} is not a readable directory in the canon tree: ${e.message}`, fix: `restore ${root}` });
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.mjs') && !isTest(entry.name)) files.add(`${root}/${entry.name}`);
    }
  }

  const packs = await loadPacks();
  const byId = new Map(packs.map((p) => [p.id, p]));
  const ids = [];
  for (const entry of resolveDeclaredPacks(declaredEntries ?? [], packs)) {
    const id = packEntryId(entry);
    if (id !== undefined && byId.has(id) && !ids.includes(id)) ids.push(id);
  }
  for (const id of ids) walk(`packs/${id}`, files, errors);

  const requiredBy = new Map(extraSkills.map((s) => [s, ['extraSkills']]));
  for (const id of ids) {
    for (const skill of byId.get(id).skills ?? []) {
      requiredBy.set(skill, [...(requiredBy.get(skill) ?? []), id]);
    }
  }
  for (const [skill, requirers] of [...requiredBy].sort(([a], [b]) => a.localeCompare(b))) {
    if (existsSync(join(canonRoot, 'skills', skill))) walk(`skills/${skill}`, files, errors);
    else errors.push({
      what: `skill "${skill}" (required by ${requirers.join(', ')}) is missing from skills/`,
      fix: 'restore the skill, or drop it from the requirer\'s skills list',
    });
  }

  // Coherence guard: the set must be import-closed — every relative import in
  // every .mjs it carries resolves to a file it also carries. Structural
  // discovery plus the requires closure make that true by construction while
  // the corpus honors pack-independence (a pack imports only its own files and
  // the engine surface, both always in the set); a violation is canon-side
  // breakage, reported here so convergence aborts BEFORE any write (the
  // transactional contract) instead of the flipped member crashing on a
  // missing module — the failure the gated flip's pilot abort surfaced.
  const inSet = new Set(files);
  for (const file of inSet) {
    if (!file.endsWith('.mjs')) continue;
    let src;
    try { src = readFileSync(join(canonRoot, file), 'utf8'); } catch { continue; }
    for (const { spec } of relativeImports(src)) {
      const resolved = resolveRelative(file, spec, (p) => existsSync(join(canonRoot, p)));
      if (!resolved) {
        errors.push({
          what: `${file} imports "${spec}", which resolves to no file in the canon tree`,
          fix: 'fix the import specifier, or restore the file it names',
        });
      } else if (!inSet.has(resolved)) {
        errors.push({
          what: `${file} imports "${spec}" → ${resolved}, which the vendor set does not carry — a pack imports only its own files and the engine surface (pack-independence)`,
          fix: 'fix the import to honor pack-independence (declare the dependency and contribute configuration, or move the helper into checks/lib)',
        });
      }
    }
  }

  return { files: [...files].sort(), errors };
}
