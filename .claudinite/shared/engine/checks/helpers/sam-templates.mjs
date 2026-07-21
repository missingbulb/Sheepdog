import { parseYaml } from './minimal-yaml.mjs';

// Every resource across the repo's tracked SAM templates, parsed.
// Returns [{ templatePath, name, resource }].
export function samResources(ctx) {
  const out = [];
  for (const f of ctx.tracked.filter((p) => /(^|\/)template\.ya?ml$/.test(p))) {
    const doc = parseYaml(ctx.read(f) || '');
    const res = doc && typeof doc === 'object' ? doc.Resources : null;
    if (res && typeof res === 'object' && !Array.isArray(res)) {
      for (const [name, resource] of Object.entries(res)) {
        if (resource && typeof resource === 'object') out.push({ templatePath: f, name, resource });
      }
    }
  }
  return out;
}
