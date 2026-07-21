import { copyFileSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverPacks } from '../packs/registry.mjs';
import { computeVendorSet, SHARED_SUBDIR } from './vendor.mjs';

// The vendor WRITER (mount/DESIGN.md): converge a consumer's .claudinite/shared/
// to this canon tree's vendor set and advance the stamp — the local half of the
// transactional update. Callers: the adoption flow and an on-demand refresh run
// it from a freshly fetched canon tree against the consumer checkout; the
// nightly's fleet integration performs the equivalent writes over the API.
// Convergence is unconditional and whole-set: shared/ is rebuilt from the set
// (stale files vanish, local edits revert), .claudinite/local_packs/ and
// everything else in the consumer is untouched. Errors abort BEFORE any write —
// the repo keeps running its old snapshot (the transactional contract).
//
// Convergence is direction-blind (copy-if-different), so a canon checkout behind
// main would silently REWIND the member's whole corpus and stamp it newer (#328).
// Two guards refuse that before any write, when the canon root carries git
// metadata: a passed --ref must equal the checkout's HEAD, and the member's
// previously stamped ref must be an ancestor of it. A rootless canon tree
// (bootstrap's fetched snapshot — no .git) skips both: it is head by
// construction and carries no history to check ancestry against.
const canonRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// All git use is LOCAL introspection of the canon checkout (rev-parse,
// merge-base read the object db — no network, no credential); the remote-head
// comparison the guards can't make locally is the worker's, over MCP. Git
// discovers .git by walking UP, and a VENDORED copy of this file runs inside
// the consumer's own repo (.claudinite/shared/mount/) — where git would answer
// with the CONSUMER's HEAD — so only a checkout whose toplevel is the canon
// root itself speaks for the canon; anything else is treated as rootless.
const git = (...args) => execFileSync('git', args, { cwd: canonRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const gitHead = () => {
  try {
    if (realpathSync(git('rev-parse', '--show-toplevel')) !== realpathSync(canonRoot)) return null;
    return git('rev-parse', 'HEAD');
  } catch { return null; }
};
const isAncestorOfHead = (sha) => { try { git('merge-base', '--is-ancestor', sha, 'HEAD'); return true; } catch { return false; } };

export async function applyVendor(targetRoot, { ref = null } = {}) {
  const settingsPath = join(targetRoot, '.claudinite-checks.json');
  if (!existsSync(settingsPath)) {
    return { errors: [{ what: `${targetRoot} has no .claudinite-checks.json`, fix: 'write the pack declaration first (adoption seeds it)' }] };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    return { errors: [{ what: `.claudinite-checks.json is not valid JSON: ${e.message}`, fix: 'fix the JSON syntax, then rerun' }] };
  }
  const declared = Array.isArray(raw.packs) ? raw.packs : [];

  const head = gitHead();
  if (head) {
    if (ref && ref !== head) {
      return { errors: [{ what: `--ref ${ref} does not match this canon checkout's HEAD (${head})`, fix: 'sync the checkout to the verified remote head (git fetch && git merge --ff-only), then rerun with that head as --ref' }] };
    }
    ref = ref ?? head; // stamp provenance even when the caller passed none
    const prior = raw.claudinite?.ref;
    if (prior && !isAncestorOfHead(prior)) {
      return { errors: [{ what: `the target's stamped ref (${prior}) is not an ancestor of this checkout's HEAD (${head}) — converging would rewind the member (#328)`, fix: 'sync the canon checkout to the remote head (git fetch && git merge --ff-only; ensure full history), then rerun' }] };
    }
  }

  // Skills the canon can't derive: ones the consumer's own local packs require.
  // Only canon-resident names count — a local pack's bundled skills live in the
  // consumer's tree and are never vendored.
  const local = (await discoverPacks({ localRoot: targetRoot })).packs.filter((p) => p.local);
  const extraSkills = [...new Set(local.flatMap((p) => p.skills ?? []))]
    .filter((name) => existsSync(join(canonRoot, 'skills', name)));

  const { files, errors } = await computeVendorSet(declared, { extraSkills });
  if (errors.length) return { errors };

  const sharedDir = join(targetRoot, SHARED_SUBDIR);
  rmSync(sharedDir, { recursive: true, force: true });
  for (const file of files) {
    const dest = join(sharedDir, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(canonRoot, file), dest);
  }

  // Full ISO datetime, not a bare date: note selection is same-day-INCLUSIVE
  // against the stamp's day (a note landing later on the stamp's day must still
  // apply — #330), and the datetime pins exactly when this snapshot was taken.
  raw.claudinite = { updated: new Date().toISOString(), ...(ref ? { ref } : {}) };
  writeFileSync(settingsPath, JSON.stringify(raw, null, 2) + '\n');
  return { files: files.length, stamp: raw.claudinite, errors: [] };
}

// CLI: node <canon>/mount/apply-vendor.mjs [--target <consumer-root>] [--ref <sha>]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const result = await applyVendor(opt('--target') ?? process.cwd(), { ref: opt('--ref') ?? null });
  if (result.errors.length) {
    for (const e of result.errors) console.error(`ERROR: ${e.what}\n  fix: ${e.fix}`);
    process.exit(1);
  }
  console.log(`vendored ${result.files} files into ${SHARED_SUBDIR}; stamp ${JSON.stringify(result.stamp)}`);
}
