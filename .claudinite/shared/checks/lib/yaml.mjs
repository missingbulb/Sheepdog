// A MINIMAL YAML-subset parser — dependency-free, sufficient to query the
// STRUCTURE of SAM/CloudFormation templates (nested block maps, block and flow
// sequences, scalars). Deliberately NOT a general YAML parser:
//   - no anchors/aliases, no multi-line block scalars (| >), no flow maps
//   - CloudFormation short tags (!Ref, !Sub, !GetAtt …) keep their scalar value,
//     the tag is dropped
//   - it never throws: on anything it can't parse it returns what it has (or null)
// Good enough for the SAM/CloudFormation template checks; do not use it for
// arbitrary YAML.

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function scalar(rawIn) {
  let raw = rawIn.trim();
  if (raw === '' || raw === '~' || raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw[0] === '!') {
    // CloudFormation tag: drop the tag word, keep the value
    const sp = raw.indexOf(' ');
    raw = sp === -1 ? '' : raw.slice(sp + 1).trim();
    if (raw === '') return null;
  }
  if ((raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'")) {
    return raw.slice(1, -1);
  }
  if (raw[0] === '[') return flowSeq(raw);
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d*\.\d+$/.test(raw)) return Number(raw);
  return raw;
}

function flowSeq(raw) {
  const inner = raw.slice(1, raw.lastIndexOf(']')).trim();
  if (inner === '') return [];
  return inner.split(',').map((s) => scalar(s.trim()));
}

const isSeq = (t) => t === '-' || t.startsWith('- ');

// Parse the block whose sibling lines all sit at lines[i].indent; returns [value, next].
function parseBlock(lines, i) {
  const indent = lines[i].indent;

  if (isSeq(lines[i].text)) {
    const arr = [];
    while (i < lines.length && lines[i].indent === indent && isSeq(lines[i].text)) {
      const rest = lines[i].text === '-' ? '' : lines[i].text.slice(2).trim();
      if (rest === '') {
        if (i + 1 < lines.length && lines[i + 1].indent > indent) {
          const [v, ni] = parseBlock(lines, i + 1); arr.push(v); i = ni;
        } else { arr.push(null); i += 1; }
      } else if (splitKey(rest)) {
        // "- key: value" (+ deeper lines) → a map item
        const sub = [{ indent: indent + 2, text: rest }];
        let j = i + 1;
        while (j < lines.length && lines[j].indent > indent) { sub.push(lines[j]); j += 1; }
        const [v] = parseBlock(sub, 0); arr.push(v); i = j;
      } else { arr.push(scalar(rest)); i += 1; }
    }
    return [arr, i];
  }

  const obj = {};
  while (i < lines.length && lines[i].indent === indent && !isSeq(lines[i].text)) {
    const kv = splitKey(lines[i].text);
    if (!kv) { i += 1; continue; } // not a key: line we understand — skip it
    const [key, rest] = kv;
    if (rest === '') {
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [v, ni] = parseBlock(lines, i + 1); obj[key] = v; i = ni;
      } else { obj[key] = null; i += 1; }
    } else { obj[key] = scalar(rest); i += 1; }
  }
  return [obj, i];
}

// Split "key: rest" at the first unquoted colon followed by space or end-of-line.
function splitKey(text) {
  let q = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
      let key = text.slice(0, i).trim();
      if ((key[0] === '"' && key.at(-1) === '"') || (key[0] === "'" && key.at(-1) === "'")) key = key.slice(1, -1);
      return [key, text.slice(i + 1).trim()];
    }
  }
  return null;
}

export function parseYaml(text) {
  try {
    const lines = [];
    for (const raw of text.split('\n')) {
      const nc = stripComment(raw);
      if (nc.trim() === '') continue;
      if (/^(---|\.\.\.)\s*$/.test(nc.trim())) continue;
      lines.push({ indent: nc.length - nc.trimStart().length, text: nc.trim() });
    }
    if (!lines.length) return null;
    return parseBlock(lines, 0)[0];
  } catch {
    return null; // never throw — a check that can't parse simply finds nothing
  }
}
