#!/usr/bin/env node
// SessionStart hook: mount the ACTIVE packs' bundled skills. A skill lives in
// exactly one pack's own tree (`<pack>/skills/<skill>/`, canon and local alike
// — #385); this hook takes the union over the packs declared in
// .claudinite-checks.json (no pack is active by default — bootstrap seeds
// `basics`, which bundles the baseline skills)
// and (re)generates the `.claude/skills/<name>` symlinks to match —
// created, retargeted, and removed as the declarations change, so the mounted
// set always tracks the packs and nothing is ever committed (a committed link
// dangles on any plain checkout, where the gitignored corpus is absent — see
// gha/pages-artifact-symlinks). A generated, self-ignoring
// `.claude/skills/.gitignore` keeps the mounts out of git status. Entries this
// hook doesn't own — a project's own skills, links pointing elsewhere — are
// never touched. Fails soft: a broken mount must never block a session.
// Registered per-repo, after whatever populates the corpus — see bootstrap.md.
import {
  existsSync, mkdirSync, readdirSync, lstatSync, readlinkSync, readFileSync,
  writeFileSync, symlinkSync, unlinkSync,
} from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  // This module lives at <corpus>/engine/pack_loader/.
  const corpusRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let declared = [];
  const configPath = join(projectRoot, '.claudinite-checks.json');
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    if (Array.isArray(raw.packs)) declared = raw.packs;
  }

  const { loadPacks, isActive } = await import(join(corpusRoot, 'engine', 'pack_loader', 'pack-registry.mjs'));
  // Include the project's own local packs — a local pack can require a canon
  // skill AND bundle its own under <pack>/skills/, mounted from the tracked pack
  // dir rather than the corpus mount.
  const packs = await loadPacks({ localRoot: projectRoot });
  // Both local roots: the canonical .claudinite/local/packs and the pre-rename
  // .claudinite/local_packs, so a mount from either is recognized as ours during
  // the migration window (skills themselves resolve off each pack's own dir).
  const localPacksRoots = [
    join(projectRoot, '.claudinite', 'local', 'packs'),
    join(projectRoot, '.claudinite', 'local_packs'),
  ];

  // The union over the active packs' bundled skills — every <pack>/skills/<name>
  // carrying a SKILL.md, resolved to that directory. Canon packs sort before
  // local ones, so a name shared with a canon pack's skill resolves to canon.
  const active = packs.filter((p) => isActive(p, { packs: declared }));
  const sourceByName = new Map();
  for (const pack of active) {
    const bundleRoot = join(pack.dir, 'skills');
    if (!existsSync(bundleRoot)) continue;
    for (const entry of readdirSync(bundleRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || sourceByName.has(entry.name)) continue;
      const dir = join(bundleRoot, entry.name);
      if (existsSync(join(dir, 'SKILL.md'))) sourceByName.set(entry.name, dir);
    }
  }
  const wanted = [...sourceByName.keys()].sort();

  const mountDir = join(projectRoot, '.claude', 'skills');
  if (!wanted.length && !existsSync(mountDir)) process.exit(0);
  mkdirSync(mountDir, { recursive: true });

  const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
  // A mount is ours iff it is a symlink into a pack's bundled skills — the
  // corpus's packs/ tree or the project's own local_packs (#383) — lexical
  // resolve, so a dangling leftover still matches and gets cleaned. (The
  // pre-#385 legacy skills roots retired with phase 3 — every member mounts
  // from pack trees.)
  const ownedRoots = [
    join(corpusRoot, 'packs'),
    ...localPacksRoots,
  ];
  const owned = (entry) => {
    const st = lstatOrNull(join(mountDir, entry));
    if (!st || !st.isSymbolicLink()) return false;
    const target = resolve(mountDir, readlinkSync(join(mountDir, entry)));
    return ownedRoots.some((r) => target.startsWith(r + sep));
  };

  for (const entry of readdirSync(mountDir)) {
    if (entry !== '.gitignore' && owned(entry) && !wanted.includes(entry)) {
      unlinkSync(join(mountDir, entry));
    }
  }

  const mounted = [];
  for (const name of wanted) {
    const link = join(mountDir, name);
    const target = relative(mountDir, sourceByName.get(name));
    if (lstatOrNull(link)) {
      if (!owned(name)) continue; // the project's own entry wins — never overwrite
      if (readlinkSync(link) === target) { mounted.push(name); continue; }
      unlinkSync(link); // ours, but stale target (corpus/pack moved) — retarget
    }
    symlinkSync(target, link);
    mounted.push(name);
  }

  const gitignorePath = join(mountDir, '.gitignore');
  const gitignore = [
    '# GENERATED by Claudinite (engine/pack_loader/mount-skills.mjs) — the skill mounts the',
    '# active packs require, regenerated every session start. Not tracked.',
    '.gitignore',
    ...mounted,
  ].join('\n') + '\n';
  if (!lstatOrNull(gitignorePath) || readFileSync(gitignorePath, 'utf8') !== gitignore) {
    writeFileSync(gitignorePath, gitignore);
  }
} catch {
  // fail soft — a broken mount must never block a session
}
