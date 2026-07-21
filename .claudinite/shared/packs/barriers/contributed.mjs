import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { finding } from '../../checks/lib/findings.mjs';
import { LOCAL_PACKS_SUBDIR } from '../registry.mjs';
import {
  normalizeEdges, barrierFindings, staleFindings, specFinding, DEFAULT_DOC,
} from './engine.mjs';

// Pack-contributed barriers — how another pack ships a FIXED barrier without
// importing this pack's code (pack-independence). The contributing pack
// declares `requires: ['barriers']` and carries the barrier as DATA on its
// manifest:
//
//   contributes: { barriers: [{ id, edges, description?, why?, doc?,
//                               severity?, crossingExcuse?, gateDir? }] }
//
// The runner's generic seam hands this pack the ACTIVE pack list
// (`contributedRules` on pack.mjs); this factory builds a first-class rule per
// contribution — the contribution's own id, so per-rule overrides
// (`rules: { "<id>": "off" }`) and acceptances keep addressing it exactly as
// they addressed the formerly code-composed rule. `gateDir` is the one
// declarative gate a contribution may carry: the rule stays inert until that
// directory exists in the repo under test (the vendored-mount gate the
// baseline's isolation barrier rides).
function contributedRule({ id, edges, severity = 'blocking', doc = DEFAULT_DOC, description, why, crossingExcuse, gateDir }) {
  const norm = normalizeEdges(edges);
  const rule = {
    id,
    severity,
    doc,
    description: description || 'Files under a guarded folder must not reference a barred folder',
    why: why || 'a folder barrier encodes an architectural boundary; a crossing reference erodes it silently',
    // Pack-shipped edges can't take project-side except entries, so a fixed
    // barrier names its real excusal lever here (see barrierFindings).
    crossingExcuse,
    run(ctx) {
      if (gateDir && !existsSync(join(ctx.root, gateDir))) return [];
      const out = norm.errors.map((e) => specFinding(rule, e));
      const { findings, stale } = barrierFindings(ctx, norm.edges, rule);
      out.push(...findings);
      const scanErrors = findings.some((f) => f.resolved === undefined);
      if (ctx.mode === 'all' && !norm.errors.length && !scanErrors) out.push(...staleFindings(stale, rule));
      return out;
    },
  };
  return rule;
}

// A malformed contribution must fail loudly at the contributing manifest, not
// silently enforce nothing (the same posture as a malformed barriers config).
function faultRule(file, what) {
  const rule = {
    id: 'barrier',
    severity: 'blocking',
    doc: DEFAULT_DOC,
    description: 'A contributed barrier must be well-formed',
    why: 'a malformed barrier contribution silently enforces nothing',
  };
  return {
    ...rule,
    run: () => [finding(rule, {
      file,
      what,
      fix: 'shape the contribution as contributes: { barriers: [{ "id": ..., "edges": [...] }] } on the pack manifest',
    })],
  };
}

// The `contributedRules` seam's body: every ACTIVE pack's barrier
// contributions, built into first-class rules. Only the list the runner hands
// over is consulted — an undeclared pack contributes nothing, exactly as its
// own rules would not run.
export function contributedBarrierRules(activePacks) {
  const rules = [];
  for (const pack of activePacks) {
    const contrib = pack.contributes?.barriers;
    if (contrib === undefined || contrib === null) continue;
    const manifest = `${pack.local ? LOCAL_PACKS_SUBDIR : 'packs'}/${pack.id}/pack.mjs`;
    if (!Array.isArray(contrib)) {
      rules.push(faultRule(manifest, `the "${pack.id}" pack's contributes.barriers is not an array`));
      continue;
    }
    for (const c of contrib) {
      if (c === null || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) {
        rules.push(faultRule(manifest, `the "${pack.id}" pack contributes a barrier with no string "id"`));
        continue;
      }
      rules.push(contributedRule(c));
    }
  }
  return rules;
}
