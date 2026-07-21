#!/usr/bin/env node
// Claude Code PreToolUse guard: blocks Bash commands that delete a remote branch
// (the delete-push fails in this environment, so it can never succeed).
// Exit 2 blocks the tool call and feeds stderr back to the agent. Registered
// per-repo — see bootstrap.md.
import { hooklog } from '../checks/helpers/hook-log.mjs';

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch { /* no payload → allow */ }
  if (payload.tool_name !== 'Bash') process.exit(0);
  const cmd = payload.tool_input?.command ?? '';
  const deletesRemoteBranch =
    /\bgit\s+push\b[^\n;&]*\s(--delete|-d)\s/.test(cmd) ||
    /\bgit\s+push\b[^\n;&]*\s\S+\s+:\S/.test(cmd);
  if (deletesRemoteBranch) {
    // Log only the block — the interesting event. An allowed command every Bash
    // call would flood the log and drown the SessionStart signal it exists for.
    hooklog('PreToolUse', 'done exit=2 blocked-remote-branch-delete');
    process.stderr.write(
      'Blocked: never delete a remote branch — a current environment bug makes the delete-push fail, so it cannot succeed. Leave the branch; it can be deleted from the GitHub UI if needed.'
    );
    process.exit(2);
  }
  process.exit(0);
});
