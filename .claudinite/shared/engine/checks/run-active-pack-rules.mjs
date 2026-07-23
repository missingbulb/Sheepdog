// Scope-blind mechanism (no policy, no scope knowledge): given a built context
// and the discovered packs, run the ACTIVE packs' rules that a caller-supplied
// predicate admits, and return their findings. The world and work runners each
// call this with their own `includeRule` — this file never names a scope, so
// the two runners stay independent of each other while sharing the walk.
import { runRule } from './helpers/work.mjs';
import { isActive } from '../pack_loader/pack-registry.mjs';

export function contributedRules(pack, fromPacks, onError = null) {
  try { return pack.contributedRules?.(fromPacks) ?? []; }
  catch (e) { onError?.(e); return []; }
}

export function runActivePackRules(ctx, packs, { includeRule, onContributeError = null }) {
  const findings = [];
  ctx.packs = packs;
  const activePacks = packs.filter((p) => isActive(p, ctx.config));
  for (const pack of activePacks) {
    const contributed = contributedRules(pack, activePacks,
      onContributeError ? (e) => onContributeError(pack, e) : null);
    for (const rule of [...(pack.rules ?? []), ...(pack.skillChecks ?? []), ...contributed]) {
      if (!includeRule(rule)) continue;
      if (ctx.config.rules[rule.id] === 'off') continue;
      findings.push(...runRule(rule, ctx));
    }
  }
  return findings;
}
