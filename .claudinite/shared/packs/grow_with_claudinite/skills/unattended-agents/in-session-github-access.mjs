import { finding } from '../../../../engine/checks/helpers/findings.mjs';

// In-session routine/worker code reaches GitHub through the session's MCP tools —
// never a REST client + GITHUB_TOKEN. This is the corollary of the dispatch-only
// executor rule (SKILL.md): a routine's own steps operate over the repos the session
// was granted, which the MCP GitHub tools already cover, so they need no token; only
// a capability the session LACKS (an account-wide credential, a sandbox-unreachable
// surface) belongs in a workflow_dispatch-only executor that runs in CI with that
// token.
//
// So a REST client, a raw api.github.com fetch, or a GITHUB_TOKEN read in in-session
// code is the tell that the code was built as if it were the CI executor — it cannot
// authenticate in the MCP-only session it is scheduled in. This is exactly the
// regression that turned the fleet daily maintenance into a no-op day when its
// planner + migration passes were (re)written as token-authed REST node scripts:
// every step 401'd because the scheduled session has no shell GitHub REST credential.
//
// RELEVANCE (see engine/checks/README.md "Adding a rule" / routine-structure.mjs): a skill
// check runs on every repo, so it must detect relevance before asserting. Here the
// scope IS the relevance gate — only .mjs under routines/, migrations/, or a
// run_daily/ dir (the in-session code surface). A dispatch-only executor's own code
// (e.g. a census invoked by a workflow) lives outside those trees and keeps its REST
// client legitimately, so it is never scanned.

const IN_SESSION = [/^routines\//, /^migrations\//, /(^|\/)run_daily\//];
const inSession = (f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && IN_SESSION.some((re) => re.test(f));

// Actionable REST/token smells — matched as code, not prose mentions (a comment
// saying "no GITHUB_TOKEN here" carries none of these exact forms).
const SMELLS = [
  { re: /process\.env\.(?:GITHUB_TOKEN|GH_TOKEN|FLEET_GITHUB_TOKEN)/, what: 'reads a GitHub REST token from the environment' },
  { re: /\bmakeGh\s*\(|from\s+['"][^'"]*\bfleet-api/, what: 'uses the REST client (makeGh / fleet-api)' },
  { re: /['"`]https?:\/\/api\.github\.com/, what: 'targets the GitHub REST API (api.github.com) directly' },
];

const isComment = (ln) => { const t = ln.trimStart(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); };

const rule = {
  id: 'in-session-github-access',
  severity: 'blocking',
  description: 'In-session routine code reaches GitHub through the MCP tools, not a REST client + GITHUB_TOKEN',
  doc: 'skills/unattended-agents/SKILL.md',
  why: 'a routine runs in an MCP-only session with no shell GitHub REST credential; a REST client / GITHUB_TOKEN in its own steps cannot authenticate there — that belongs in a workflow_dispatch-only CI executor',

  run(ctx) {
    const out = [];
    for (const f of ctx.files.filter(inSession)) {
      const text = ctx.read(f);
      if (text === null) continue;
      text.split('\n').forEach((ln, i) => {
        if (isComment(ln)) return;
        for (const s of SMELLS) {
          if (s.re.test(ln)) {
            out.push(finding(rule, {
              file: f, line: i + 1,
              what: `${s.what} — in-session routine code has no REST credential`,
              fix: 'reach GitHub through the session’s injected MCP-backed I/O (a gh(path) reader for reads, a semantic io object for writes); move any work that needs an account-wide credential into a workflow_dispatch-only executor',
            }));
            break;
          }
        }
      });
    }
    return out;
  },
};

export default rule;
