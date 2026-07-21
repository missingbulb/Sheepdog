import { finding } from '../../checks/lib/findings.mjs';

// Corpus-integrity rule for the pack-driven skill mounts: each pack declares
// the skills it requires (`skills` in its pack.mjs), and consumers mount the
// union over their active packs (skills/mount-skills.mjs) — so a skill no pack
// requires never reaches any repo, and a declaration naming a missing skill
// mounts nothing. Only meaningful in the Claudinite repo itself; a consumer
// tracks neither registry (the corpus lives under its gitignored mount), which
// is the cheap, specific relevance gate a corpus-wide rule needs.
const rule = {
  id: 'skill-ownership',
  severity: 'blocking',
  description: 'Every corpus skill is required by at least one pack, and every pack-required skill exists',
  doc: 'skills/README.md',
  why: 'skill mounts are derived from pack declarations — an unowned skill is dead weight no consumer ever mounts, and a dangling declaration mounts nothing',

  run(ctx) {
    if (!ctx.tracked.includes('packs/registry.mjs') || !ctx.tracked.includes('skills/registry.mjs')) {
      return [];
    }

    const skills = new Set();
    for (const f of ctx.tracked) {
      const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(f);
      if (m) skills.add(m[1]);
    }

    const owners = new Map(); // skill name -> pack ids that require it
    for (const pack of ctx.knownPacks ?? []) {
      for (const name of pack.skills ?? []) {
        owners.set(name, [...(owners.get(name) ?? []), pack.id]);
      }
    }

    const out = [];
    for (const name of [...skills].sort()) {
      if (owners.has(name)) continue;
      out.push(finding(rule, {
        file: `skills/${name}/SKILL.md`,
        what: `no pack requires the "${name}" skill, so no consumer ever mounts it`,
        fix: `add "${name}" to the skills list of each pack whose projects need it (basics for a baseline activity), or delete the skill`,
      }));
    }
    for (const [name, packIds] of [...owners.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (skills.has(name)) continue;
      out.push(finding(rule, {
        file: `packs/${packIds[0]}/pack.mjs`,
        what: `pack "${packIds.join('", "')}" requires the skill "${name}" but skills/${name}/SKILL.md does not exist`,
        fix: `create skills/${name}/SKILL.md or drop "${name}" from the pack's skills list`,
      }));
    }
    return out;
  },
};

export default rule;
