---
name: bump-version
description: Raise the project's version — a minor bump by default. Use when the owner says "bump version".
---

The mechanics are the consuming project's — its release/workflow doc names which files carry
the version and how a release follows. For a Chrome-extension repo the standard applies
([the chrome-extension-release pack's RELEASE.md](../../../../packs/chrome-extension-release/RELEASE.md)):
edit the manifest and `package.json` together on a branch (default the next **minor**), land on
`main` via a normal PR — merging the bump *is* cutting the release.
