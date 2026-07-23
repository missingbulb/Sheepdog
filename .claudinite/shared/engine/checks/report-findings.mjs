// Scope-blind mechanism: apply the project's severity overrides and acceptances,
// order blocking-first, print each finding, and print the one-line summary.
// Returns the blocking count so a runner's exit code is `blocking ? 1 : 0`.
// `scopeLabel` only names the run in the summary line (e.g. "world" / "work") —
// this file carries no scope logic of its own.
import { applyConfig, render } from './helpers/findings.mjs';

export function reportFindings(findings, config, { scopeLabel, mode, baseRef }) {
  const resolved = applyConfig(findings, config)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1));
  for (const f of resolved) console.log(`${render(f)}\n`);
  const blocking = resolved.filter((f) => f.severity === 'blocking').length;
  const advisory = resolved.length - blocking;
  if (resolved.length) {
    console.log(`${blocking} blocking, ${advisory} advisory (${scopeLabel} scope: ${mode}${baseRef ? ` vs ${baseRef}` : ''}).`);
  }
  return blocking;
}
