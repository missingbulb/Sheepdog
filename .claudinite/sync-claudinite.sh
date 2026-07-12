#!/bin/bash
# DO NOT DELETE. In a consuming repo this tracked file is both the Method B sync
# hook and the committed signal that the project mounts Claudinite
# (https://github.com/missingbulb/Claudinite) — fleet maintenance discovers
# opted-in repos by its presence on the default branch. Everything else under
# .claudinite/ is synced by this hook and gitignored; only this file is tracked.
# Canonical source: sync-claudinite.sh at the Claudinite repo root. Never edit a
# consumer's copy — the nightly re-bootstrap refreshes it from the canon.
#
# Syncs Claudinite into .claudinite/ over plain HTTPS (codeload is allowlisted;
# a submodule clone 403s on cloud). Pulls latest main. On a failed sync it keeps
# any prior copy silently; only when there is NO copy at all (the harness would be
# absent) does it inject a directive telling the assistant to halt and ask.
# Set CLAUDINITE_REF to a branch/tag/SHA to pin instead of tracking main.
set -euo pipefail
REF="${CLAUDINITE_REF:-main}"
URL="https://codeload.github.com/missingbulb/Claudinite/tar.gz/${REF}"
dest="${CLAUDE_PROJECT_DIR:-.}/.claudinite"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if curl -fsSL --retry 2 --max-time 30 "$URL" -o "$tmp/c.tgz" 2>/dev/null \
   && tar -tzf "$tmp/c.tgz" >/dev/null 2>&1; then
  rm -rf "$dest.new"; mkdir -p "$dest.new"
  tar -xzf "$tmp/c.tgz" -C "$dest.new" --strip-components=1
  # The tracked copy of this hook wins over the tarball's, so a canon update never
  # dirties the consumer's working tree mid-cycle — the nightly re-bootstrap is
  # this file's update path. (.gitkeep: legacy pre-relocation marker, preserved
  # until the re-bootstrap migration removes it.)
  [ -f "$dest/sync-claudinite.sh" ] && cp "$dest/sync-claudinite.sh" "$dest.new/sync-claudinite.sh"
  [ -f "$dest/.gitkeep" ] && cp "$dest/.gitkeep" "$dest.new/.gitkeep"
  rm -rf "$dest"; mv "$dest.new" "$dest"; exit 0
fi
[ -f "$dest/README.md" ] && exit 0   # offline: prior copy present, harness still loads
# No prior copy: the harness is absent and the session would run vanilla. A SessionStart
# hook can't block or prompt on its own, so inject a directive telling the assistant to
# halt and confirm with the user before doing any work. stdout is added to the session
# context; the message is plain text (no double quotes or backslashes) so it embeds in
# the JSON string directly.
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' \
  "CLAUDINITE NOT LOADED: the sync failed and no local .claudinite/ copy exists, so @.claudinite/CLAUDE.md is unresolved and none of the Claudinite harness (packs, skills, preferences) is active this session. STOP: before running any other tool, answering, or starting the requested task, use the AskUserQuestion tool to ask the user whether to proceed without the harness or pause and retry the sync; do not proceed until they answer."
exit 0
