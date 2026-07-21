import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillsDir = dirname(fileURLToPath(import.meta.url));

// A skill may own the test-the-world checks that validate its action, kept beside
// the SKILL.md that defines that action rather than in a pack. Discover them
// structurally: any skills/<name>/checks.mjs (default export = array of rules) is
// picked up — no registry list to maintain. Skill checks are never declared and
// always run (unlike packs, which — basics included — run only when
// declared); each is inert until its artifact exists.
export async function loadSkillRules() {
  const rules = [];
  for (const name of readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()) {
    const manifest = join(skillsDir, name, 'checks.mjs');
    if (existsSync(manifest)) rules.push(...(await import(pathToFileURL(manifest).href)).default);
  }
  return rules;
}
