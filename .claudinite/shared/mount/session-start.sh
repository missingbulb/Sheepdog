#!/bin/bash
# SessionStart orchestrator — the ONE place the corpus-dependent session-start
# steps run, IN SEQUENCE, in a single process.
#
# Why this exists: Claude Code runs hook entries IN PARALLEL with
# non-deterministic order ("all matching hooks run in parallel… the order is
# non-deterministic" — the Claude Code hooks docs). So a populate-then-read
# chain spread across separate SessionStart entries (sync populates .claudinite/,
# then prefs/prose/skills read it) is a race, not a sequence — the cause of
# intermittent "the harness didn't load this session" reports. Everything that
# reads .claudinite/ therefore runs HERE, after whatever populated the corpus:
#   - Method B consumer: sync-claudinite.sh syncs, then calls this.
#   - Method A consumer / the Claudinite repo itself: call this directly (the
#     corpus is already present — a submodule, or the repo checkout).
#
# Each step's stdout is forwarded to this hook's stdout, which SessionStart adds
# to the session context (prose, preferences, halt-and-ask directives). Progress
# — a timestamp and what it is doing — is written to .claudinite-hooks.log and to
# stderr, so a triggering failure (no lines at all) reads differently from an
# execution failure (a step logged `start` but not `done`).
#
# Always exits 0: a SessionStart hook cannot block, and a non-zero exit makes
# Claude Code DISCARD this hook's stdout — including any step's halt-and-ask
# directive, the load-bearing safety gate. Failure is surfaced via the log and
# the injected directives, never the exit code.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# This script lives in <corpus>/mount/. The preferences step lives beside it
# (per-user content is never vendored, so its step is mount machinery — see
# DESIGN.md); the remaining step scripts stay in their domains one level up
# (<corpus>/packs, <corpus>/skills).
corpus="$(dirname "$here")"

# --- durable hook log (format mirrored in sync-claudinite.sh and
# --- checks/lib/hooklog.mjs — keep the three in step). Lives at the project
# --- root, OUTSIDE .claudinite/, so a sync's dir swap never wipes it. Best
# --- effort: logging must never fail a hook.
CLAUDINITE_LOG="${CLAUDE_PROJECT_DIR:-.}/.claudinite-hooks.log"
CLAUDINITE_HOOK_RUN="${CLAUDINITE_HOOK_RUN:-$$}"; export CLAUDINITE_HOOK_RUN
# Bound the log across sessions (no-op when a Method B sync already trimmed it).
if [ -f "$CLAUDINITE_LOG" ] && [ "$(wc -c <"$CLAUDINITE_LOG" 2>/dev/null || echo 0)" -gt 262144 ]; then
  tail -n 400 "$CLAUDINITE_LOG" >"$CLAUDINITE_LOG.tmp" 2>/dev/null && mv "$CLAUDINITE_LOG.tmp" "$CLAUDINITE_LOG" 2>/dev/null || true
fi
hooklog() {
  local ts; ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '?')"
  local line="$ts run=$CLAUDINITE_HOOK_RUN $1: $2"
  printf '%s\n' "$line" >>"$CLAUDINITE_LOG" 2>/dev/null || true
  printf '%s\n' "$line" >&2 2>/dev/null || true
}

# Run one step, forwarding its stdout to ours (→ session context) and logging
# its lifecycle. A step failing (they fail soft) never aborts the rest — hence
# no `set -e`. Tallies feed the one-line confirmation footer below.
ran=0; labels=""; warns=""
run_step() {
  local label="$1"; shift
  hooklog "$label" "start"
  "$@"
  local rc=$?
  hooklog "$label" "done exit=$rc"
  ran=$((ran + 1))
  labels="${labels:+$labels, }$label"
  [ "$rc" -ne 0 ] && warns="${warns:+$warns; }$label exited $rc"
}

hooklog orchestrator "start"
run_step inject-preferences bash "$here/inject-preferences.sh"
run_step load-active-prose  node "$corpus/packs/load-active-prose.mjs"
run_step mount-skills       node "$corpus/skills/mount-skills.mjs"
run_step env-check          node "$corpus/packs/env.mjs" check
run_step interview-check    node "$corpus/packs/interview.mjs" check
hooklog orchestrator "done"

# One terse, visible confirmation into the session context that the harness ran
# this session — the healthy-case counterpart to the loud halt directives. It
# reports that the machinery ran (not that every step succeeded semantically — a
# soft halt still exits 0), and flags any step that actually crashed.
end_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '?')"
summary="Claudinite session-start: ran $ran steps ($labels) at $end_ts."
[ -n "$warns" ] && summary="$summary WARNING: $warns."
printf '%s\n' "$summary"
exit 0
