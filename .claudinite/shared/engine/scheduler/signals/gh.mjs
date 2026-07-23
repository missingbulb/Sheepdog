// The Action-side GitHub reader for the scheduler (per-project-scheduling
// DESIGN §10: engine/scheduler/ is the one place that legitimately uses the
// Action's GITHUB_TOKEN — everything session-side stays MCP-only). A minimal
// REST client over global fetch: `gh(path) -> { status, json }`, the same shape
// the fleet planner's injected reader uses, so the collectors read uniformly and
// test against a fake `gh`.
//
// `path` is an API path beginning with `/` (e.g. `/repos/owner/name/commits`);
// the base URL and auth are applied here. A non-2xx returns `{ status, json:
// null }` rather than throwing, so a 404 (no release yet, missing file) is data,
// not an error.

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

export function makeGh({ token = process.env.GITHUB_TOKEN, api = API, fetchImpl = fetch } = {}) {
  return async function gh(path, { method = 'GET', body } = {}) {
    const res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'user-agent': 'claudinite-scheduler',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  };
}

export async function lastSuccessTime(gh, repo, workflowFile = 'claudinite-scheduler.yml') {
  const { status, json } = await gh(`/repos/${repo}/actions/workflows/${workflowFile}/runs?status=success&per_page=1`);
  if (status !== 200) return null;
  const run = json?.workflow_runs?.[0];
  return run ? (run.run_started_at || run.created_at || null) : null;
}

export function actionRepoContext(env = process.env) {
  return {
    repo: env.GITHUB_REPOSITORY || null,
    defaultBranch: env.GITHUB_REF_NAME || 'main',
  };
}
