// The sheepdog census's cross-repo GitHub REST client. Dependency-free (global
// fetch, Node 20+). This is the ONE place a Claudinite process talks GitHub over
// raw REST with a token, and it is deliberately confined to the census — the
// account-spanning coverage audit that must enumerate EVERY repo the owner owns
// (`/user/repos`), which a session-scoped connection structurally cannot see. The
// census runs as its own workflow_dispatch Action with a fine-grained PAT; nothing
// in the daily-maintenance process imports this (that process is MCP-native and
// carries no REST client). It knows nothing about any specific pack: it is the
// generic "talk to many repos" layer, no more.

const API = 'https://api.github.com';

export function makeGh(token) {
  return async function gh(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    return { status: res.status, json };
  };
}

export async function paged(gh, path) {
  const sep = path.includes('?') ? '&' : '?';
  const all = [];
  for (let page = 1; ; page += 1) {
    const { status, json } = await gh(`${path}${sep}per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(json)) {
      throw new Error(`GET ${path} page ${page} failed with status ${status}`);
    }
    all.push(...json);
    if (json.length < 100) return all;
  }
}

// 200 → true, 404 → false, anything else → error (the caller decides what an
// indeterminate result means).
export async function fileExists(gh, fullName, path) {
  const { status } = await gh(`/repos/${fullName}/contents/${path}`);
  if (status === 200) return true;
  if (status === 404) return false;
  throw new Error(`marker check ${fullName}:${path} returned ${status}`);
}

// Does this repo mount Claudinite? (Method B sync hook / legacy gitkeep / Method A
// submodule.) The structural "is this a covered member" test, shared by the planner
// (which repos to plan over) and the census (which repos are uncovered).
export async function isCovered(gh, fullName) {
  // The tracked declaration file is THE membership signal — the one file every
  // member carries whatever its mount shape (the engine can't run without it,
  // and baselining backfills it nightly), and the only shape the planner can
  // plan for at all (activePacks is read from it). A mount marker WITHOUT a
  // declaration is a half-adoption that must classify as uncovered — the census
  // then opens an adoption issue and it heals loudly, instead of rotting as a
  // "covered" repo no task ever runs on. (vendoring/DESIGN.md)
  return fileExists(gh, fullName, '.claudinite-checks.json');
}
