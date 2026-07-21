#!/usr/bin/env node
// Render a captured conversation log as owner ↔ assistant dialogue markdown —
// what the conversation-extract daily task posts on the worked issue when a rule is
// extracted (README.md owns the standard; conversation-extract.md owns when to post).
// Just the dialogue: tool traffic, injected/meta turns, and sidechain noise are
// filtered by the same transcript helpers the conversation checks use.
//
// Usage: node render-dialogue.mjs <log.jsonl> [--max-chars <n>]
// With --max-chars, chunks are separated by a `=== 8< ===` line — post each
// chunk as its own issue comment (GitHub caps a comment at 65,536 characters).

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEntries, humanTurns, assistantTextAfter } from '../../engine/checks/helpers/session-transcript.mjs';

export function renderDialogue(entries) {
  const parts = [];
  for (const turn of humanTurns(entries)) {
    parts.push(`**Owner:**\n\n${turn.text.trim()}`);
    const reply = assistantTextAfter(entries, turn.index).trim();
    if (reply) parts.push(`**Assistant:**\n\n${reply}`);
  }
  return parts.join('\n\n---\n\n');
}

// Greedy paragraph packing under `max` characters; a single oversized paragraph
// is hard-split rather than overflowing a chunk.
export function chunkText(text, max) {
  const chunks = [];
  let cur = '';
  const push = () => { if (cur) { chunks.push(cur); cur = ''; } };
  for (const para of text.split('\n\n')) {
    const candidate = cur ? `${cur}\n\n${para}` : para;
    if (candidate.length <= max) { cur = candidate; continue; }
    push();
    if (para.length <= max) { cur = para; continue; }
    for (let i = 0; i < para.length; i += max) {
      const piece = para.slice(i, i + max);
      if (i + max >= para.length) cur = piece; else chunks.push(piece);
    }
  }
  push();
  return chunks;
}

function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: render-dialogue.mjs <log.jsonl> [--max-chars <n>]');
    process.exit(2);
  }
  const maxIdx = argv.indexOf('--max-chars');
  const max = maxIdx === -1 ? null : Number(argv[maxIdx + 1]);
  const md = renderDialogue(parseEntries(readFileSync(file, 'utf8')));
  if (!max) { console.log(md); return; }
  console.log(chunkText(md, max).join('\n\n=== 8< === next comment === 8< ===\n\n'));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
