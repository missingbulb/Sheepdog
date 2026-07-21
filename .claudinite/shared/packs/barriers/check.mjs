import {
  normalizeEdges, barrierFindings, staleFindings, specFinding, DEFAULT_DOC,
} from './engine.mjs';

// The project-declared barrier check: a repo states its folder-access graph as
// `config.rules` on its barriers pack entry in .claudinite-checks.json (the
// loader overlays each pack entry's `config` onto `packConfig`), and this
// enforces it. A rule owns its exceptions — carve-out strings and reviewed
// { path, to?, reason } crossings both live in the rule's own `except`, so a NEW
// coupling in an already-reviewed file still fails and paid-down debt goes stale.
// (A pack that ships a *fixed* barrier uses engine.mjs `defineBarrier` instead and
// adds it to its own `rules`.)
const rule = {
  id: 'barrier',
  severity: 'blocking',
  doc: DEFAULT_DOC,
  description: "Folders must not reference across a declared barrier (the barriers pack entry's config)",
  why: 'a declared folder barrier encodes an architectural boundary; a crossing reference erodes it silently',

  run(ctx) {
    const cfg = ctx.config?.packConfig?.barriers;
    if (cfg === undefined || cfg === null) return []; // declared but unconfigured — nothing to enforce
    if (typeof cfg !== 'object' || Array.isArray(cfg) || !('rules' in cfg)) {
      return [specFinding(rule, {
        what: 'the barriers config must be an object with a "rules" array',
        fix: 'set { "packs": [ { "id": "barriers", "config": { "rules": [ { "from": "...", "to": "..." } ] } } ] }',
      })];
    }
    const out = [];
    const unknown = Object.keys(cfg).filter((k) => k !== 'rules');
    if (unknown.length) {
      out.push(specFinding(rule, {
        what: `the barriers config has unknown ${unknown.length > 1 ? 'properties' : 'property'} ${unknown.map((k) => `"${k}"`).join(', ')} — exceptions live per-rule now, in each rule's "except"`,
        fix: 'it takes only "rules"; move accept/except entries into the owning rule\'s "except"',
      }));
    }
    const { edges, errors } = normalizeEdges(cfg.rules);
    out.push(...errors.map((e) => specFinding(rule, e)));

    const { findings, stale } = barrierFindings(ctx, edges, rule);
    out.push(...findings);

    // Staleness is trustworthy only on a whole-repo sweep with a clean config: a
    // --changed run sees only part of the findings, and any config/scan error
    // means the scan was incomplete.
    const scanErrors = findings.some((f) => f.resolved === undefined);
    if (ctx.mode === 'all' && !unknown.length && !errors.length && !scanErrors) {
      out.push(...staleFindings(stale, rule));
    }
    return out;
  },
};

export default rule;
