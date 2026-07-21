// Helpers for checks that scan source *code* for a forbidden token (a banned
// API, an impure import, a DOM specific). Such a check must see code, not
// prose: a comment or a doc-string that merely *names* `chrome.storage` or
// `fetch(` is describing the code, not doing it, and matching it is a false
// positive that fails the build over an English sentence. Strip comments first.

// Return `source` with its JS/TS comments removed, leaving everything else —
// including string and template literals — byte-for-byte intact. String-aware
// on purpose: a `//` inside "https://…" is not a comment, and dropping the rest
// of that line would corrupt real code (and could hide a genuine violation that
// follows on the same line). Regex literals are treated as code and preserved.
// Newlines inside block comments are kept so line numbers don't shift.
export function stripComments(source) {
  let out = '';
  let state = 'code'; // code | line | block | sq | dq | tpl
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i++; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i++; continue; }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      out += c;
    } else if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
    } else if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; i++; }
      else if (c === '\n') out += c;
    } else {
      // Inside a string/template literal: copy through until the matching quote,
      // honoring backslash escapes so an escaped quote doesn't end it early.
      out += c;
      if (c === '\\') { out += c2 ?? ''; i++; }
      else if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
        state = 'code';
      }
    }
  }
  return out;
}
