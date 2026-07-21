import { finding } from '../../engine/checks/helpers/findings.mjs';

// Converted from engineering-practices: a GENERATED file gets a `merge=ours`
// .gitattributes entry so a conflicting merge resolves automatically instead of
// being hand-edited (which desyncs it from its source). Directional → advisory.
function globToRe(glob) {
  return new RegExp(
    `^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`
  );
}

const rule = {
  id: 'generated-merge-driver',
  severity: 'advisory',
  description: 'A GENERATED file needs a .gitattributes merge=ours entry',
  doc: 'skills/engineering-practices/SKILL.md',
  why: 'without merge=ours a conflicting merge on a generated file gets hand-resolved and desyncs from its source',

  run(ctx) {
    // allFiles, not files: this is the one check that reasons *about* generated files,
    // so it must see them even when a repo also marks them linguist-generated (which
    // the engine otherwise drops from ctx.files).
    const generated = ctx.allFiles.filter((f) => f.split('/').pop().includes('GENERATED'));
    if (!generated.length) return [];
    const patterns = (ctx.read('.gitattributes') || '')
      .split('\n')
      .filter((l) => /\bmerge=ours\b/.test(l) && !l.trim().startsWith('#'))
      .map((l) => globToRe(l.trim().split(/\s+/)[0]));

    return generated
      .filter((f) => !patterns.some((re) => re.test(f) || re.test(f.split('/').pop())))
      .map((f) => finding(rule, {
        file: f,
        what: 'a GENERATED file with no merge=ours .gitattributes entry',
        fix: `add \`${f.split('/').pop()} merge=ours\` to .gitattributes (plus a one-time \`git config merge.ours.driver true\`) so a conflicting merge auto-resolves`,
      }));
  },
};

export default rule;
