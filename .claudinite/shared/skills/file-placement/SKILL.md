---
name: file-placement
description: Where a file should live — the reference-distance metric, the high-reach code smell, and the mandated-location and test-location exemptions. Use before placing, moving, or renaming a file, or when reviewing where one lives.
---

# File placement

Where a file *lives* in a repository is a design decision, not a clerical one. This doc gives a portable rule for judging that placement: keep files close to the files they actually depend on. It is project-agnostic — the consuming repo's own docs own any project-specific layout conventions (where tests go, where generated output lands, framework-mandated folders, etc.). This is about the *shape* of the dependency graph relative to the folder tree, not about naming.

## The reference-distance metric

Treat the repository as a tree of folders. For any reference one file makes to another (an import, an include, a relative-path link, a sibling asset it reads), measure the **distance** between them as the number of folder edges you traverse in that tree to get from one file's folder to the other's:

- **Distance 0** — both files are in the **same folder**. The reference is local.
- **Distance 1** — the target is **one folder up or one folder down** (a parent or a direct child folder). One edge.
- **Distance 2** — the target is in a **sibling folder**: a different child of the same parent. You go **up one** edge to the shared parent, then **down one** edge into the sibling. Two edges.
- **Distance _n_** — in general, the count of folder edges on the shortest path between the two folders in the tree. Each "up to a common ancestor" step and each "down into a subfolder" step is one edge.

> A sibling reference is **distance 2** (up one, then down one) under this edge-counting model — not 3. Keep this consistent: the distance is just the length of the shortest folder-to-folder path in the tree.

Distance 0 and 1 are *cohesion*: the file and what it needs are neighbors. Anything 2 or higher is *reach* — the file is grabbing across the tree.

## The rule

**A file should mostly reference files at distance 0 or 1.** Same folder, the folder above, or a folder below. That is the healthy case: a module knows its neighbors and its parent/children, and little else.

It is a **code smell** when:

- many of a file's references are at distance 2+, or
- a single reference is at a large distance (reaching across several folders to a far corner of the tree), or
- a whole folder's files all reach into the same distant folder — that pair of folders probably wants to be adjacent, or merged.

High average reference-distance means the folder structure and the dependency structure disagree. The tree is supposed to *encode* what depends on what; when files routinely reach far away, the tree has stopped telling the truth.

## What to do about a smell

Don't treat a long reference as something to suppress — treat it as a signal that placement is wrong. Options, roughly in order of preference:

- **Move the file** next to what it depends on, so the reference collapses to distance 0 or 1.
- **Move the dependency** the other way, if the dependency is the thing that's misplaced and several files want it nearby.
- **Lift a shared dependency** to the nearest common ancestor when several sibling folders all reach for it — distance 2-from-each becomes distance-1 from a parent everyone already touches.
- **Introduce a boundary** (a small public entry point / index for a subtree) so outsiders reference *one* near file instead of reaching deep into the subtree's internals. This converts many deep references into one shallow one.
- **Accept it, deliberately,** for genuine cross-cutting concerns (a top-level shared/util/config that everything legitimately depends on). These exist; the point is they should be *few and named*, not the accidental norm.

## Special case: files whose location is mandated

Some files **cannot** live next to what they relate to, because a tool or platform dictates exactly where they go. A GitHub workflow must sit under `.github/workflows/`; agent/config files live under `.claude/` (or `.cloud/`, `.vscode/`, `.devcontainer/`, etc.); many ecosystems require a manifest at the repo root (`package.json`, `pyproject.toml`, `Dockerfile`). Their placement is fixed by an external contract, not chosen by you.

**Exempt these from the distance metric.** A mandated-location file that "reaches far" into the code it acts on is not a smell — it has no choice, and moving the code to satisfy the metric would be backwards. Don't refactor to shorten a reference whose distance is forced by a tool's required path.

But the exemption is **narrow and one-directional**:

- It covers only the **mandated** file and **only the references the mandate forces.** A workflow under `.github/` referencing a script elsewhere is fine. Ordinary code reaching *into* `.github/` for something that didn't have to live there is still a smell — the metric applies normally in that direction.
- Keep the mandated file **thin**: a launcher that references one near entry point, not a file that reaches deep into many distant internals. Put the real logic in a normally-placed file at distance 0/1 from what it uses, and have the mandated file point at *that*. This keeps the long, forced reference single and shallow instead of spraying deep references from a corner of the tree.
- The exemption is for **truly mandated** locations, not merely conventional or convenient ones. "It's customary to put it here" is not a mandate — if you could place the file nearer its dependencies and the tooling wouldn't care, the normal rule still applies.

## Special case: test files

Tests are a common source of long references that are **not** placement smells. A project's test-location convention — a mirrored `test/` or `tests/` tree, a `__tests__/` folder, a `*_test.go` sibling, a `spec/` root — fixes where a test file lives, and that location is often far from the file under test. The resulting long reference from the test to the tested file is **forced by the convention, not by misplacement.**

**Don't move files to shorten a test reference, or vice versa.** Where a project already has a standard for test locations, that standard wins: leave the tested file where its production neighbors are (distance 0/1 from *them*), leave the test where the convention puts it, and accept the distance between them. Relocating production code to sit nearer its test — or scattering tests next to code when the project mirrors them into a separate tree — trades a real, project-wide standard for a metric the standard already overrides.

Apply the same narrowness as the mandated-location case: the exemption covers the **test → tested-file** reference that the convention forces, and it presumes the project *has* such a convention. Absent any standard, ordinary placement judgment still applies — co-locating a test with the code it exercises is a perfectly good distance-0 choice.

**When picking a test-location convention from scratch, mirror the source tree — one test per source file at the same relative path** (`src/<area>/<name>` tested by `test/<area>/<name>.test`). The path *is* the link: a source file never has to name its own test in a comment, and a missing or misfiled test is obvious at a glance. Keep departures (whole-interaction tests, tests with no single source file to mirror) few and deliberate.

## Tooling acts on paths: encode act-on-able distinctions structurally

A file's path is an interface not only for developers but for automated processes — build globs, linters, and access rules often act on a file by its location alone, without reading its content. When two kinds of file must be treated differently by tooling that reads only paths, make the distinction **structural**: give each kind its own folder so the path itself carries the signal.

Keep such a split fail-safe: name the narrower or less-protected kind explicitly, and let the safer behavior be the default, so a misplaced file lands on the safe side rather than the dangerous one.

This complements the reference-distance metric, which asks *what a file depends on*. This axis asks *what acts on the file by path* — and for path-driven tooling, placement is the only interface it sees.

## Why this works

- **Locality of change.** Edits ripple to neighbors, not across the repo. When related files sit together, a change and its blast radius share a folder.
- **The tree stays honest.** Folder structure should be a readable map of the dependency graph. Low reference-distance keeps the map matching the territory.
- **Cheaper navigation.** A reader following a reference travels a short path, not a tour of the tree.
- **Refactors localize.** Moving or deleting a subtree is safe when its outside references are few and shallow; it's perilous when half the repo reaches in.

## How to apply it

- When **placing a new file**, put it where its distance-0/1 neighbors are — with the files it will import and that will import it. If no such home exists, that's a hint the structure needs a new folder, not that the file goes "somewhere."
- When **reviewing**, scan a file's imports/links and ask how far each reaches. A cluster of distance-2+ references is a refactor prompt, not a nit.
- Use it as a **direction, not a hard gate.** The goal is low *average* reach and no surprising *far* reach — not a mechanical ban on distance ≥ 2.

