// Session-transcript parsing for conversation-surface rules (Stop hook only —
// CI has no transcript, so rules must return [] when ctx.conversation() is null).
// A Claude Code transcript is JSONL; the shapes this reads were verified against
// a real session file, not inferred: an owner turn is `type: "user"` with plain
// string message content (tool results arrive as content arrays, injected/meta
// turns carry isMeta, subagent traffic carries isSidechain, and synthetic turns
// — hook output, reminders, webhook activity — are tag-wrapped, starting with "<").

export function parseEntries(text) {
  const entries = [];
  for (const line of (text || '').split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* partial trailing write — skip the line */ }
  }
  return entries;
}

function humanText(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return null;
  const content = entry.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) && content.length && content.every((c) => c?.type === 'text')
      ? content.map((c) => c.text).join('\n')
      : null;
  if (!text || text.trimStart().startsWith('<')) return null;
  return text;
}

// The owner's own turns, in order: [{ index, timestamp, text }].
export function humanTurns(entries) {
  const turns = [];
  entries.forEach((entry, index) => {
    const text = humanText(entry);
    if (text !== null) turns.push({ index, timestamp: entry.timestamp ?? null, text });
  });
  return turns;
}

// Concatenated assistant text emitted after entry `fromIndex`, up to the next
// owner turn (or the end of the session).
export function assistantTextAfter(entries, fromIndex) {
  const parts = [];
  for (let i = fromIndex + 1; i < entries.length; i += 1) {
    const entry = entries[i];
    if (humanText(entry) !== null) break;
    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'text' && block.text) parts.push(block.text);
    }
  }
  return parts.join('\n');
}

// The explicit classification line, if the reply carries one.
export function classificationLine(text) {
  const m = /^[ \t>#*_-]*comment\s+class\b[^:\n]*:(.*)$/im.exec(text || '');
  return m ? m[0] : null;
}

// Canonical class tokens named on a classification line (a mixed comment may
// name several): 'correction' | 'feature' | 'process-change' | 'other'.
export function classesIn(line) {
  const classes = new Set();
  for (const m of (line || '').matchAll(/correction|feature|process[\s-]change|other/gi)) {
    classes.add(m[0].toLowerCase().replace(/\s+/g, '-'));
  }
  return classes;
}

// Each owner turn with the classes its reply declared (empty set = unclassified).
export function classifiedTurns(entries) {
  return humanTurns(entries).map((turn) => ({
    ...turn,
    classes: classesIn(classificationLine(assistantTextAfter(entries, turn.index))),
  }));
}
