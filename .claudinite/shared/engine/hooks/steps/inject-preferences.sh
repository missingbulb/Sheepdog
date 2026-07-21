#!/bin/bash
# SessionStart step: inject the current user's interaction preferences into the
# session context (stdout is forwarded by the session-start orchestrator).
#
# Preferences are PER-USER settings, not project content, so a consumer never
# vendors them (vendoring/DESIGN.md): read the local copy when this tree carries
# one (the canon repo itself; a future submodule mount; the interim full-tarball
# sync), otherwise fetch just this user's file over HTTPS, fresh. Deliberately
# FAIL-SOFT on every miss — the load-bearing cargo (packs, checks, skills) is
# already local, and preferences are a nice-to-have: a miss injects a one-line
# note and the session proceeds on defaults, never a halt directive.
set -uo pipefail

note() { printf '%s\n' "$1"; }

email="${CLAUDE_CODE_USER_EMAIL:-}"
if [ -z "$email" ]; then
  note "PREFERENCES: CLAUDE_CODE_USER_EMAIL is not set — proceeding with default interaction behavior."
  exit 0
fi
# Strip quotes/backslashes before embedding the email in a message, so an
# unusual address stays tidy in the injected text.
safe_email="$(printf '%s' "$email" | tr -d '"\\')"

# Local first: <corpus>/preferences/<email>.md relative to this script's tree
# (<corpus>/engine/hooks/steps/).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prefs="$here/../../../preferences/$email.md"
if [ -f "$prefs" ]; then
  cat "$prefs"
  exit 0
fi

# No local copy (a vendored consumer): fetch this one file. CLAUDINITE_PREFS_URL
# overrides the base for a fork or a test.
base="${CLAUDINITE_PREFS_URL:-https://raw.githubusercontent.com/missingbulb/Claudinite/main/preferences}"
if out="$(curl -fsSL --retry 2 --max-time 15 "$base/$email.md" 2>/dev/null)" && [ -n "$out" ]; then
  printf '%s\n' "$out"
  exit 0
fi
note "PREFERENCES: no local copy and the fetch for ${safe_email} failed — proceeding with default interaction behavior."
exit 0
