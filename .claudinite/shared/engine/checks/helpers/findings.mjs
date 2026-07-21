export function finding(rule, { file, line = null, what, fix, why = null, severity = null }) {
  return {
    rule: rule.id,
    severity: severity || rule.severity,
    file,
    line,
    what,
    why: why || rule.why,
    fix,
    doc: rule.doc,
  };
}

// Severity overrides then acceptances, in that order, so an acceptance is judged
// against the rule the project actually runs. A reasonless acceptance is itself
// a blocking finding: the reason string is what makes the decision reviewable.
export function applyConfig(findings, config) {
  const out = [];
  for (let f of findings) {
    const override = config.rules[f.rule];
    if (override === 'advisory' || override === 'blocking') f = { ...f, severity: override };
    // A path ending in "/" accepts a whole subtree; otherwise the match is exact.
    const acceptance = config.accept.find(
      (a) => a.rule === f.rule &&
        (!a.path || a.path === f.file || (a.path.endsWith('/') && f.file.startsWith(a.path)))
    );
    if (acceptance) {
      if (typeof acceptance.reason === 'string' && acceptance.reason.trim()) continue;
      out.push({
        rule: 'config',
        severity: 'blocking',
        file: '.claudinite-checks.json',
        line: null,
        what: `acceptance for ${f.rule}${acceptance.path ? ` on ${acceptance.path}` : ''}${acceptance.pack ? ` (on the "${acceptance.pack}" pack entry)` : ''} has no reason`,
        why: 'the reason string is what makes an accepted violation reviewable',
        fix: 'add a non-empty "reason" to the acceptance entry',
        doc: 'engine/checks/README.md',
      });
    }
    out.push(f);
  }
  return out;
}

export function render(f) {
  const loc = f.line ? `${f.file}:${f.line}` : f.file;
  return [
    `[${f.severity.toUpperCase()}] ${f.rule}  ${loc}`,
    `  ${f.what}`,
    ...(f.why ? [`  Why: ${f.why}`] : []),
    `  Fix: ${f.fix}`,
    ...(f.doc ? [`  More: ${f.doc}`] : []),
  ].join('\n');
}
