import { finding } from '../../checks/lib/findings.mjs';

// Validate the grow_with_claudinite pack entry's config (the loader overlays
// each entry's `config` onto packConfig). Declared-but-unconfigured is fine and
// fail-safe — capture and the growth tasks run, promotion participates, and the
// conversation nightly's retention sweep deletes nothing until the project
// states an explicit retention_days (no silent default; the adoption question
// asks for it). `promote: false` opts this repo out of the central promote
// stage while it keeps extracting and deduping locally.
const rule = {
  id: 'growth-config',
  severity: 'blocking',
  doc: 'packs/grow_with_claudinite/README.md',
  description: "The grow_with_claudinite entry's config takes only retention_days (positive integer) and promote (boolean)",
  why: 'a malformed retention config silently stalls the conversation retention sweep, and a mistyped promote flag silently changes what leaves the repo',

  run(ctx) {
    const cfg = ctx.config?.packConfig?.grow_with_claudinite;
    if (cfg === undefined || cfg === null) return [];
    const bad = (what, fix) => [finding(rule, { file: '.claudinite-checks.json', line: null, what: `grow_with_claudinite config: ${what}`, fix })];
    if (typeof cfg !== 'object' || Array.isArray(cfg)) {
      return bad('must be an object', 'set { "packs": [ { "id": "grow_with_claudinite", "config": { "retention_days": 10 } } ] }');
    }
    const unknown = Object.keys(cfg).filter((k) => k !== 'retention_days' && k !== 'promote');
    if (unknown.length) {
      return bad(`unknown ${unknown.length > 1 ? 'properties' : 'property'} ${unknown.map((k) => `"${k}"`).join(', ')}`,
        'it takes only "retention_days" and "promote"');
    }
    if ('retention_days' in cfg && !(Number.isInteger(cfg.retention_days) && cfg.retention_days >= 1)) {
      return bad(`retention_days must be a positive integer, got ${JSON.stringify(cfg.retention_days)}`,
        'set retention_days to a whole number of days (10 is the recommended floor)');
    }
    if ('promote' in cfg && typeof cfg.promote !== 'boolean') {
      return bad(`promote must be a boolean, got ${JSON.stringify(cfg.promote)}`,
        'set promote to false to opt this repo out of the central promote stage (absent/true = participate)');
    }
    return [];
  },
};

export default rule;
