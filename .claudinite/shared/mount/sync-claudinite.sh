#!/bin/bash
# DO NOT DELETE. In a consuming repo this tracked file is the LEGACY
# (fetch-at-session-start) sync hook for Claudinite
# (https://github.com/missingbulb/Claudinite); it is retired per repo by the
# vendored-mount flip (mount/DESIGN.md) — fleet membership keys on the tracked
# .claudinite-checks.json, not on this file. The synced corpus under
# .claudinite/ is gitignored; the tracked exceptions are this file — at
# .claudinite/mount/sync-claudinite.sh — and the repo's own
# .claudinite/local_packs/ (project packs), both preserved across the sync's dir
# swap below. Canonical source: mount/sync-claudinite.sh at the Claudinite repo.
# Never edit a consumer's copy — the nightly re-bootstrap refreshes it from the canon.
#
# Syncs Claudinite into .claudinite/ over plain HTTPS from codeload (which the
# environment's network policy must allowlist; a submodule clone 403s on cloud).
# Pulls latest main, THEN fans out to the corpus-dependent session-start steps by
# calling .claudinite/mount/session-start.sh (preferences, active-pack prose, skill
# mounts, env check). This is the SINGLE SessionStart entry a Method B consumer
# registers: Claude Code runs hook entries in parallel with non-deterministic
# order, so populate-then-read must happen in ONE process — not across sibling
# hook entries, which would race. On a failed sync it keeps any prior copy
# silently (and still fans out against it); only when there is NO copy at all
# (the harness would be absent) does it inject a directive telling the assistant
# to halt and ask. Set CLAUDINITE_REF to a branch/tag/SHA to pin instead of
# tracking main.
set -euo pipefail
REF="${CLAUDINITE_REF:-main}"
URL="https://codeload.github.com/missingbulb/Claudinite/tar.gz/${REF}"
dest="${CLAUDE_PROJECT_DIR:-.}/.claudinite"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# --- durable hook log (a timestamp + what each hook is doing). Format is
# --- mirrored in session-start.sh and checks/lib/hooklog.mjs — keep the three in
# --- step. This file is present BEFORE .claudinite/ exists (it is the one
# --- tracked bootstrap file), so it cannot source a shared helper; it inlines
# --- the logger. The log lives at the project root, OUTSIDE .claudinite/, so the
# --- dir swap below never wipes it.
CLAUDINITE_LOG="${CLAUDE_PROJECT_DIR:-.}/.claudinite-hooks.log"
CLAUDINITE_HOOK_RUN="${CLAUDINITE_HOOK_RUN:-$$}"; export CLAUDINITE_HOOK_RUN
if [ -f "$CLAUDINITE_LOG" ] && [ "$(wc -c <"$CLAUDINITE_LOG" 2>/dev/null || echo 0)" -gt 262144 ]; then
  tail -n 400 "$CLAUDINITE_LOG" >"$CLAUDINITE_LOG.tmp" 2>/dev/null && mv "$CLAUDINITE_LOG.tmp" "$CLAUDINITE_LOG" 2>/dev/null || true
fi
hooklog() {
  local ts; ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '?')"
  local line="$ts run=$CLAUDINITE_HOOK_RUN $1: $2"
  printf '%s\n' "$line" >>"$CLAUDINITE_LOG" 2>/dev/null || true
  printf '%s\n' "$line" >&2 2>/dev/null || true
}
# Fan out the corpus-dependent steps, in order, in this one process. Guarded and
# `|| true`: an absent or failing orchestrator (e.g. a pre-relocation prior copy)
# must never turn this hook non-zero — a non-zero SessionStart exit makes Claude
# Code discard the stdout the steps just emitted into the session context.
fan_out() {
  local s
  for s in "$dest/mount/session-start.sh" "$dest/session-start.sh"; do
    if [ -f "$s" ]; then bash "$s" || true; return 0; fi
  done
  return 0
}

hooklog sync "start ref=$REF"
if curl -fsSL --retry 2 --max-time 30 "$URL" -o "$tmp/c.tgz" 2>/dev/null \
   && tar -tzf "$tmp/c.tgz" >/dev/null 2>&1; then
  rm -rf "$dest.new"; mkdir -p "$dest.new"
  tar -xzf "$tmp/c.tgz" -C "$dest.new" --strip-components=1
  # The consumer's tracked copy of this hook wins over the tarball's, so a canon
  # update never dirties their working tree mid-cycle — the nightly re-bootstrap is
  # this file's update path. The tracked copy now lives at mount/; the pre-mount
  # root path and the legacy .gitkeep marker are preserved too, so a not-yet-
  # migrated tree also stays clean until baselining relocates it.
  if [ -f "$dest/mount/sync-claudinite.sh" ]; then
    mkdir -p "$dest.new/mount"
    cp "$dest/mount/sync-claudinite.sh" "$dest.new/mount/sync-claudinite.sh"
  fi
  [ -f "$dest/sync-claudinite.sh" ] && cp "$dest/sync-claudinite.sh" "$dest.new/sync-claudinite.sh"
  [ -f "$dest/.gitkeep" ] && cp "$dest/.gitkeep" "$dest.new/.gitkeep"
  # Preserve the consumer's own local packs across the swap. .claudinite/local_packs/
  # is tracked PROJECT content (a repo's own prose/checks/skills/run_daily packs) that
  # the canon tarball never carries — so, like the tracked hook, it must survive the
  # rm -rf or every session start would delete it (git would then show tracked-file
  # deletions). rm the staged copy first so a future canon tarball that ever shipped
  # its own local_packs/ can't nest the consumer's inside it.
  if [ -d "$dest/local_packs" ]; then
    rm -rf "$dest.new/local_packs"
    cp -R "$dest/local_packs" "$dest.new/local_packs"
  fi
  rm -rf "$dest"; mv "$dest.new" "$dest"
  hooklog sync "done exit=0 synced"
  fan_out; exit 0
fi
if [ -f "$dest/README.md" ]; then   # offline: prior copy present, harness still loads
  hooklog sync "done exit=0 used-prior-copy (fetch failed)"
  fan_out; exit 0
fi
# No prior copy: the harness is absent and the session would run vanilla. A SessionStart
# hook can't block or prompt on its own, so inject a directive telling the assistant to
# halt and confirm with the user before doing any work. SessionStart adds stdout to the
# session context; emit the directive as plain text (like every other step's output, so
# a single hook's stdout is never a mix of JSON and prose).
hooklog sync "done exit=0 NOT-LOADED no-copy (fetch failed, no local corpus)"
cat <<'EOF'
CLAUDINITE NOT LOADED: the sync failed and no local .claudinite/ copy exists, so @.claudinite/CLAUDE.md is unresolved and none of the Claudinite harness (packs, skills, preferences) is active this session. A common cause is the environment blocking the corpus fetch: codeload.github.com must be reachable and allowlisted in the environment network policy, or the sync 403s. STOP: before running any other tool, answering, or starting the requested task, use the AskUserQuestion tool to ask the user whether to proceed without the harness or pause and fix the sync (e.g. allowlist codeload.github.com, then retry); do not proceed until they answer.
EOF
exit 0
