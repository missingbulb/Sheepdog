import { finding } from '../../engine/checks/helpers/findings.mjs';

// Corpus-integrity rule: the pack catalog README must list every pack on
// disk, so the hand-maintained index can't silently drift behind a newly
// added pack (it has, twice). Only meaningful in the Claudinite repo itself;
// a consumer tracks no registry (the corpus lives under its shared mount).
// Skills have no catalog of their own (#385): a skill is its owning pack's
// content, listed nowhere but its pack.
//
// The membership token matches the catalog's own listing convention: every
// pack row links `<name>/README.md`.
const CATALOGS = [
  { kind: 'pack', member: /^packs\/([^/]+)\/pack\.mjs$/, readme: 'packs/README.md', token: (n) => `${n}/README.md` },
];

const rule = {
  id: 'catalog-completeness',
  severity: 'blocking',
  description: 'packs/README.md lists every packs/<name>/',
  doc: 'packs/README.md',
  why: 'a hand-maintained catalog that omits a real pack misroutes readers and hides capability; the check keeps the index honest against the tree',

  run(ctx) {
    if (!ctx.tracked.includes('engine/pack_loader/pack-registry.mjs')) {
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
