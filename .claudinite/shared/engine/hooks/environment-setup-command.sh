#!/usr/bin/env bash
# GENERIC Claudinite cloud environment setup — identical across projects and
# owned by the corpus (vendored into every consumer's .claudinite/shared/engine/hooks/),
# so a project commits NO copy of its own.
#
# HOW TO USE: copy this full body into the Claude Code Web environment's "Setup
# script" field (environment settings). It runs once when the environment is
# created; the filesystem is snapshotted and reused, so installs aren't repaid
# per session. Per-toolchain install logic lives in Claudinite packs
# (engine/pack_loader/env-requirements.mjs, driven by the repo's .claudinite-checks.json), NOT here — so
# this script never changes as requirements evolve.
#
# Vendored-mount only (vendoring/DESIGN.md): the corpus is tracked, already in the
# checkout — nothing is fetched here, ever. A repo still on the legacy
# fetch-at-session-start mount keeps its previously pasted script (pasted
# scripts are snapshots); pasting THIS body there fails fast at step 2 below,
# which is the signal to flip the repo first. Corrections to a repo's mount are
# the nightly maintenance's job, never this script's.
set -euo pipefail

# The Setup script runs as root starting in the checkout's PARENT dir. cd into
# the checkout — the one dir under here that mounts Claudinite.
root="$(dirname "$(find "$PWD" -maxdepth 2 -name .claudinite-checks.json 2>/dev/null | head -n1)")"
cd "$root"

# 1. Generated-file merge hygiene — universal, cheap, harmless where unused: the
#    `ours` driver .gitattributes maps GENERATED files to, plus conflict-replay.
git config merge.ours.driver true
git config rerere.enabled true

# 2. Install every active pack's declared environment requirement (Flutter SDK,
#    node deps, …). The SessionStart `env.mjs check` then probes each directly.
node .claudinite/shared/engine/pack_loader/env-requirements.mjs install
