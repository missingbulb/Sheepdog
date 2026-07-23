import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This module lives at <canon>/engine/pack_loader/; the packs it scans at <canon>/packs/.
const canonRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const packsDir = join(canonRoot, 'packs');

export const LOCAL_PACKS_SUBDIR = join('.claudinite', 'local', 'packs');
export const LEGACY_LOCAL_PACKS_SUBDIR = join('.claudinite', 'local_packs');
export const localPacksDir = (root) => join(resolve(root), LOCAL_PACKS_SUBDIR);
export const legacyLocalPacksDir = (root) => join(resolve(root), LEGACY_LOCAL_PACKS_SUBDIR);

export const SHARED_SUBDIR = join('.claudinite', 'shared');

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

async function scanPackDir(dir, { local, subdir }, errors) {
  const out = [];
  if (!existsSync(dir)) return out;
  const label = subdir ?? (local ? LOCAL_PACKS_SUBDIR : 'packs');
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) {
    errors.push({
      what: `${label} is not a readable directory: ${e.message}`,
      fix: `make ${label} a directory (or remove it)`,
      dir,
    });
    return out;
  }
  for (const name of names) {
    const packDir = join(dir, name);
    const rel = local ? `${label}/${name}` : `packs/${name}`;
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
    if (local && mod.id !== name) {
      errors.push({
        what: `the local pack in ${rel} exports id "${mod.id}" but its directory is "${name}"`,
        fix: `rename the directory to "${mod.id}", or set the pack's id to "${name}" — a local pack's id must match its directory name`,
        dir: packDir,
      });
      continue;
    }
    for (const e of packQuestions(mod).errors) errors.push({ ...e, dir: packDir });
    const pack = { ...mod, dir: packDir, local };
    pack.skillChecks = await scanSkillChecks(packDir, errors);
    out.push(pack);
  }
  return out;
}

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

export async function discoverPacks({ localRoot } = {}) {
  const errors = [];
  const canon = await scanPackDir(packsDir, { local: false }, errors);
  const local = localRoot
    ? [
      ...await scanPackDir(localPacksDir(localRoot), { local: true, subdir: LOCAL_PACKS_SUBDIR }, errors),
      ...await scanPackDir(legacyLocalPacksDir(localRoot), { local: true, subdir: LEGACY_LOCAL_PACKS_SUBDIR }, errors),
    ]
    : [];
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

export async function loadPacks(opts) {
  return (await discoverPacks(opts)).packs;
}

export const LOCAL_DECL_PREFIX = 'local/';
export const LEGACY_LOCAL_DECL_PREFIX = 'local_packs/';
const stripLocalPrefix = (id) => {
  for (const prefix of [LOCAL_DECL_PREFIX, LEGACY_LOCAL_DECL_PREFIX]) {
    if (id.startsWith(prefix)) return id.slice(prefix.length);
  }
  return id;
};

export const declTokenFor = (pack) =>
  pack.local ? LOCAL_DECL_PREFIX + pack.id : pack.id;

export const packEntryId = (entry) =>
  typeof entry === 'string'
    ? stripLocalPrefix(entry)
    : entry !== null && typeof entry === 'object' && typeof entry.id === 'string'
      ? stripLocalPrefix(entry.id)
      : undefined;

export const isActive = (pack, config) =>
  (config.packs ?? []).some((entry) => packEntryId(entry) === pack.id);

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
