// The one Stop command a consumer's .claude/settings.json wires. The settings
// file must be as clean as possible and change as seldom as possible (#385), so
// this address is the stable contract — it only routes: to check_the_work.mjs,
// the work-scoped gate that fast-exits when the session changed nothing and
// otherwise runs the full sweep (check_the_world.mjs) until it is green. Stdin
// (the hook payload), stdout/stderr, and the exit code — 2 blocks the stop —
// pass straight through.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const real = fileURLToPath(new URL('../checks/check_the_work.mjs', import.meta.url));
const r = spawnSync(process.execPath, [real, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
