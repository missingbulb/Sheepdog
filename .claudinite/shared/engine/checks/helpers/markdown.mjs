const LINK = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// Ranges of inline code spans (`...`) on one line, so links quoted as examples
// inside a span aren't treated as live references.
function codeSpans(line) {
  const spans = [];
  const re = /`+/g;
  let open = null;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (!open) open = { start: m.index, fence: m[0] };
    else if (m[0] === open.fence) { spans.push([open.start, m.index + m[0].length]); open = null; }
  }
  return spans;
}

export function extractLinks(text) {
  const links = [];
  let inFence = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const spans = codeSpans(line);
    let m;
    LINK.lastIndex = 0;
    while ((m = LINK.exec(line)) !== null) {
      const at = m.index;
      if (spans.some(([s, e]) => at >= s && at < e)) continue;
      let target = m[2];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      target = target.split('#')[0];
      if (!target) continue;
      links.push({ label: m[1].replace(/`/g, ''), target, line: i + 1 });
    }
  });
  return links;
}
