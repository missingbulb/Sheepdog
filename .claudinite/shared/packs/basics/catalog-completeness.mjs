import { finding } from '../../checks/lib/findings.mjs';

// Corpus-integrity rule: the two catalog READMEs must list every collection
// member on disk, so a hand-maintained index can't silently drift behind a
// newly added pack or skill (it has, twice). Only meaningful in the Claudinite
// repo itself; a consumer tracks neither registry (the corpus lives under its
// gitignored mount), the same cheap relevance gate skill-ownership uses.
//
// Membership token per catalog matches that catalog's own listing convention:
// every pack row links `<name>/README.md`; every skill row is the backticked
// `<name>`. A missing member means its token is absent from the README.
const CATALOGS = [
  { kind: 'pack', member: /^packs\/([^/]+)\/pack\.mjs$/, readme: 'packs/README.md', token: (n) => `${n}/README.md` },
  { kind: 'skill', member: /^skills\/([^/]+)\/SKILL\.md$/, readme: 'skills/README.md', token: (n) => `\`${n}\`` },
];

const rule = {
  id: 'catalog-completeness',
  severity: 'blocking',
  description: 'packs/README.md lists every packs/<name>/, and skills/README.md lists every skills/<name>/',
  doc: 'packs/README.md',
  why: 'a hand-maintained catalog that omits a real pack or skill misroutes readers and hides capability; the check keeps the index honest against the tree',

  run(ctx) {
    if (!ctx.tracked.includes('packs/registry.mjs') || !ctx.tracked.includes('skills/registry.mjs')) {
      return [];
    }
    const out = [];
    for (const { kind, member, readme, token } of CATALOGS) {
      const text = ctx.read(readme);
      if (text === null) continue;
      const names = new Set();
      for (const f of ctx.tracked) {
        const m = member.exec(f);
        if (m) names.add(m[1]);
      }
      for (const name of [...names].sort()) {
        if (!text.includes(token(name))) {
          out.push(finding(rule, {
            file: readme,
            what: `the ${kind} "${name}" exists on disk but is not listed in ${readme}`,
            fix: `add a "${name}" entry to ${readme} (or delete the ${kind} if it is dead)`,
          }));
        }
      }
    }
    return out;
  },
};

export default rule;
