// Posix path-prefix helpers — the engine-lib home for the containment
// primitives the barrier detection engine and pack checks share. In the engine
// lib (not any pack) because both sides of a pack boundary may need them, and
// a pack never imports another pack's code (pack-independence): a helper both
// sides need lives here.

// Normalize a folder prefix: fold separators, strip ./ and trailing /, pass
// '*' (the isolation wildcard) through untouched. A prefix that collapses to
// "" means the repo root; callers that can't accept it (targets, allow)
// reject it.
export function normPrefix(p) {
  if (p === '*') return '*';
  const s = String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  return s === '.' ? '' : s;
}

// `path` is inside folder `prefix` (or is it). '' matches everything (repo
// root); '*' never matches here (it is handled as the isolation wildcard).
export function under(path, prefix) {
  if (prefix === '') return true;
  if (prefix === '*') return false;
  return path === prefix || path.startsWith(`${prefix}/`);
}
