import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This module lives at <canon>/engine/pack_loader/; the packs it scans at <canon>/packs/.
const canonRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const packsDir = join(canonRoot, 'packs');

// A repo's own packs live at <root>/.claudinite/local_packs/<name>/ — tracked
// project content, discovered and run by the same engine as the mounted canon
// packs. This is where the subdir sits relative to a consumer's checkout root.
export const LOCAL_PACKS_SUBDIR = join('.claudinite', 'local_packs');
export const localPacksDir = (root) => join(resolve(root), LOCAL_PACKS_SUBDIR);

// Where a consumer materializes the vendored canon (vendoring/DESIGN.md): the
// corpus mirrored at canon-relative paths under this subdir. Tracked files in
// the interim; the planned future is a git submodule mounted at this same path
// — which is why nothing consumer-owned (local_packs/ above) lives inside it.
export const SHARED_SUBDIR = join('.claudinite', 'shared');

// Load a directory of `<name>/pack.mjs` manifests, isolating each import so one
// broken manifest can't sink the rest (a consumer-authored local pack.mjs must
// never disable every other pack's prose/checks/skills). Each loaded pack is
// stamped with `dir` (its own directory — prose and bundled skills resolve off
// this, so a pack's files never have to sit under a single shared root) and
// `local` (whether it came from a consumer's local_packs). A pack's skills live
// in its own tree — `<pack>/skills/<skill>/` is the one bundled-skill shape,
// canon and local alike (#385: a skill rides exactly one pack; there is no
// separate skills collection to own or cross-declare). A bundled skill's
// checks.mjs is gathered onto `skillChecks` and run by the runner only when the
// pack is active.
async function scanPackDir(dir, { local }, errors) {
  const out = [];
  if (!existsSync(dir)) return out;
  // A non-directory (or unreadable path) at a scan root is a fault to REPORT, not
  // a crash — the whole point of discovery being fail-soft is a diagnostic instead
  // of a dead runner (the SessionStart hooks fail soft; the runner surfaces it).
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) {
    errors.push({
      what: `${local ? LOCAL_PACKS_SUBDIR : 'packs/'} is not a readable directory: ${e.message}`,
      fix: `make ${local ? LOCAL_PACKS_SUBDIR : 'packs/'} a directory (or remove it)`,
      dir,
    });
    return out;
  }
  for (const name of names) {
    const packDir = join(dir, name);
    const rel = local ? `${LOCAL_PACKS_SUBDIR}/${name}` : `packs/${name}`;
    const manifest = join(packDir, 'pack.mjs');
    if (!existsSync(manifest)) continue;
    let mod;
    try {
      mod = (await import(pathToFileURL(manifest).href)).default;
    } catch (e) {
      errors.push({
        what: `the pack in ${rel} failed to load: ${e.message}`,
        fix: `fix pack.mjs in ${rel}, or remove the pack`,
        dir: packDir,
      });
      continue;
    }
    if (!mod || typeof mod.id !== 'string') {
      errors.push({
        what: `the pack in ${rel} has no string "id" default export`,
        fix: 'export default { id: "<name>", ... } from its pack.mjs',
        dir: packDir,
      });
      continue;
    }
    // A local pack's id must equal its directory name. The engine activates a pack
    // by its exported id, but the fleet planner reads a local pack's daily tasks by
    // directory name (it never imports pack.mjs), so a mismatch would silently
    // diverge — the engine runs the pack while the fleet skips its task. Require
    // dir == id so the two can never disagree (the canon convention, enforced here
    // for local packs).
    if (local && mod.id !== name) {
      errors.push({
        what: `the local pack in ${rel} exports id "${mod.id}" but its directory is "${name}"`,
        fix: `rename the directory to "${mod.id}", or set the pack's id to "${name}" — a local pack's id must match its directory name`,
        dir: packDir,
      });
      continue;
    }
    const pack = { ...mod, dir: packDir, local };
    pack.skillChecks = await scanSkillChecks(packDir, errors);
    out.push(pack);
  }
  return out;
}

// A pack's skill-owned checks: any <pack>/skills/<skill>/checks.mjs (default
// export = an array of rules). Isolated per import; run gated by the owning
// pack being active, exactly like the pack's own rules — a skill is pack
// content, so its checks ride the pack's activation.
async function scanSkillChecks(packDir, errors) {
  const rules = [];
  const skillsRoot = join(packDir, 'skills');
  if (!existsSync(skillsRoot)) return rules;
  let names;
  try {
    names = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) {
    errors.push({ what: `${LOCAL_PACKS_SUBDIR} skills path is not a readable directory: ${e.message}`, fix: 'make the pack\'s skills/ a directory (or remove it)', dir: skillsRoot });
    return rules;
  }
  for (const name of names) {
    const manifest = join(skillsRoot, name, 'checks.mjs');
    if (!existsSync(manifest)) continue;
    try {
      rules.push(...(await import(pathToFileURL(manifest).href)).default);
    } catch (e) {
      errors.push({ what: `local skill check ${name}/checks.mjs failed to load: ${e.message}`, fix: 'fix or remove the skill\'s checks.mjs', dir: join(skillsRoot, name) });
    }
  }
  return rules;
}

// Discover every pack structurally — canon `packs/<name>/pack.mjs` always, plus a
// consumer's own `<localRoot>/.claudinite/local_packs/<name>/pack.mjs` when a
// localRoot is given (the repo under test / the session's project root). No
// registry list to maintain — dropping a directory in adds it. Returns the packs
// plus any load-time `errors` (a broken manifest, a missing id, an id collision);
// the runner surfaces those as blocking `config` findings, the fail-soft
// SessionStart hooks just skip the offending pack. Canon is scanned first, so a
// local pack may not shadow a canon id — the collision is reported and the local
// one dropped (a consumer extends the canon, never silently overrides it).
export async function discoverPacks({ localRoot } = {}) {
  const errors = [];
  const canon = await scanPackDir(packsDir, { local: false }, errors);
  const local = localRoot ? await scanPackDir(localPacksDir(localRoot), { local: true }, errors) : [];
  const byId = new Map();
  const packs = [];
  for (const pack of [...canon, ...local]) {
    if (byId.has(pack.id)) {
      const first = byId.get(pack.id);
      errors.push({
        what: `pack id "${pack.id}" is declared twice — by ${first.local ? 'a local pack' : 'the canon'} and ${pack.local ? 'a local pack' : 'the canon'}`,
        fix: `rename the local pack in ${LOCAL_PACKS_SUBDIR}/ — a local pack id must be unique and may not shadow a canon pack`,
        dir: pack.dir,
      });
      continue;
    }
    byId.set(pack.id, pack);
    packs.push(pack);
  }
  return { packs, errors };
}

// The pack list alone — the shape every non-runner caller wants. Canon-only when
// no localRoot is given (the fleet planner and the declaration-writing backfill
// run in the canon checkout and read member declarations over the API, not from
// local disk). A broken/duplicate pack is simply absent here; the runner's
// discoverPacks surfaces the diagnostic.
export async function loadPacks(opts) {
  return (await discoverPacks(opts)).packs;
}

// A local pack's canonical declaration token is namespaced: `local_packs/<id>`
// — self-documenting in .claudinite-checks.json (a reader sees at a glance the
// pack lives in the repo's own tree, and a canon id can never be claimed by
// accident; the discoverPacks shadow guard stays as the backstop). The bare id
// remains accepted while the fleet migrates (the baselining rewrite + the
// local-pack-namespace migration track convergence), so packEntryId strips the
// prefix and every id comparison happens on the bare id.
export const LOCAL_DECL_PREFIX = 'local_packs/';
const stripLocalPrefix = (id) =>
  id.startsWith(LOCAL_DECL_PREFIX) ? id.slice(LOCAL_DECL_PREFIX.length) : id;

// The writer-side inverse: the token a declaration writer records for a pack —
// namespaced for a local pack, the bare id for a canon one.
export const declTokenFor = (pack) =>
  pack.local ? LOCAL_DECL_PREFIX + pack.id : pack.id;

// A `packs` declaration entry is either a plain id string or an entry object
// `{ id, config?, rules?, accept?, via? }` carrying that pack's own settings
// (see engine/checks/README.md). This is the one id-extractor every reader shares, so
// raw-JSON consumers (the SessionStart hooks, the fleet routines) and the
// engine agree on both shapes — and on both declaration forms: it returns the
// BARE pack id, stripping a `local_packs/` namespace where one is declared.
// Returns undefined for a malformed entry.
export const packEntryId = (entry) =>
  typeof entry === 'string'
    ? stripLocalPrefix(entry)
    : entry !== null && typeof entry === 'object' && typeof entry.id === 'string'
      ? stripLocalPrefix(entry.id)
      : undefined;

// No pack is active by default. Activation is exactly the project's declaration
// in .claudinite-checks.json (bootstrap's --init seeds the default-on packs).
export const isActive = (pack, config) =>
  (config.packs ?? []).some((entry) => packEntryId(entry) === pack.id);

// Import closure. A pack can't be imported without the packs it requires: a
// release pack builds on its coding pack, a project-class pack on the framework
// pack that implements it. A pack names those in its `requires` list.
// Given the entries a project declares (id strings or entry objects), return
// that set plus every pack reachable through `requires` (transitively).
// Declared entries keep their order; each pack's pulled-in dependencies land
// right after it, deterministically. This runs when the declaration is
// WRITTEN — bootstrap's `--init` and the baselining backfill — so a pack's
// prerequisites are materialized into .claudinite-checks.json, visible and
// droppable like every other entry (the same reason a seeded pack is written
// explicitly rather than defaulted), never resolved implicitly at run time.
//
// Provenance: a materialized dependency is written as `{ id, via: [...] }`,
// `via` naming the resolved packs that directly require it — the file itself
// answers "why is this pack declared". An entry already carrying `via`
// self-identifies as materialized, so its `via` is recomputed to stay accurate
// as dependents come and go (an empty recomputed `via` marks an orphan the
// project can drop); a user-authored entry (no `via`) is kept verbatim.
// A declared id is kept verbatim even if unknown (settings validation flags
// that); a dependency is only materialized when it names a real pack; an
// entry with no usable id (a settings error) is preserved untouched — the
// writer must never drop what it can't interpret.
export function resolveDeclaredPacks(declared, packs) {
  const byId = new Map(packs.map((p) => [p.id, p]));
  const declaredIds = new Set(declared.map(packEntryId).filter((id) => id !== undefined));
  const entryById = new Map();
  for (const entry of declared) {
    const id = packEntryId(entry);
    if (id !== undefined && !entryById.has(id)) entryById.set(id, entry);
  }
  const orderedIds = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    if (!declaredIds.has(id) && !byId.has(id)) return; // don't materialize a phantom dep
    seen.add(id);
    orderedIds.push(id);
    for (const dep of byId.get(id)?.requires ?? []) visit(dep);
  };
  for (const entry of declared) {
    const id = packEntryId(entry);
    if (id !== undefined) visit(id);
  }
  const via = (id) => orderedIds.filter((p) => byId.get(p)?.requires?.includes(id)).sort();
  const resolved = orderedIds.map((id) => {
    const entry = entryById.get(id);
    if (entry === undefined) return { id, via: via(id) };
    if (typeof entry === 'object' && 'via' in entry) return { ...entry, via: via(id) };
    return entry;
  });
  return [...resolved, ...declared.filter((entry) => packEntryId(entry) === undefined)];
}
