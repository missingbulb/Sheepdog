# barriers pack

Enforce a **directed folder-access graph** in a repo: declare that the files under one set of folders may not reference another, and the check finds every crossing reference — across all languages and file types. The mechanism other packs compose their separation rules on.

Declared like any pack (no fingerprint — wanting structural segregation is the project's own call; a pack that needs it names `barriers` in its `requires`). Check-only, no prose: the finding is the instruction.

## Checks (hardcoded)

| Check | Enforces (≤5 words) | Severity |
|---|---|---|
| `barrier` | folders honor declared access graph | blocking |

## Declaring barriers

A repo states its graph as `config.rules` on its **barriers pack entry** in `.claudinite-checks.json` — an array of rules. A rule is the unit; each rule owns its exceptions.

Adopting the pack without a graph is a silent no-op, so adoption asks one question — what the barriers are *for* ([the adoption interview](../README.md#adoption-interview-questions)): the owner's answer is recorded verbatim as `answers.goals` on the entry, and the edge list below is distilled from it.

```json
{
  "packs": [
    "basics",
    {
      "id": "barriers",
      "config": {
        "rules": [
          { "from": "src", "to": "tests", "reason": "source must not know about its tests" },
          { "between": ["client", "server"], "allow": ["shared", "contracts"],
            "reason": "client and server integrate only through the shared contract" },
          { "from": "dev/requirements", "to": "*", "allow": ["README.md"],
            "reason": "requirements is a pure sink — it references nothing outside itself" },
          { "from": ["engine", "cli", "loader.js"], "to": "plugins/*", "matchNames": true,
            "reason": "the host must not know the specific plugins it loads",
            "except": [
              { "path": "engine/registry.js", "to": ["plugins/legacy"],
                "reason": "temporary bridge during the plugin split — tracked in #123" }
            ] }
        ]
      }
    }
  ]
}
```

Rule fields:

- **`from`** — the folder(s) guarded: a folder, a file, `"."` for the whole repo, or an **array** of them. Naming the core folders positively (`["engine", "cli", "loader.js"]`) keeps content, catalogs, and config naturally out of scope — no carve-outs needed for them. A `from` entry may be a single engine file living *inside* a content tree (`loader.js` next to the plugins it loads); that file is guarded without the tree around it being scanned.
- **`to`** — what must not be referenced: a folder, `"<folder>/*"` (a glob barring **every direct child directory**, enumerated from the tree — files directly under `<folder>` stay reachable), `"*"` (isolation/sink: `from` may reference nothing outside itself), or an **array** of the folder/glob forms. An empty glob expansion is a blocking `config` finding, never a silent no-op: a renamed folder must not disarm the barrier.
- **`{ between: [a, b] }`** — sugar for a mutual ban (both `a → b` and `b → a`).
- **`{ siblings: "<folder>", to, ... }`** — guard **each direct child directory** of `<folder>` in
  turn (instead of `from`; the children are enumerated from the tree at scan time, and an empty
  expansion is a blocking `config` finding). `to: "<folder>/*"` gives **mutual sibling
  separation** — every child may reference its own files but no sibling's; `to: "*"` gives
  **per-child isolation**, each child confined to itself plus the `allow` list. The form for
  "these subfolders are independent units" without enumerating (and maintaining) one edge per
  unit.
- **`scope: "imports"`** — restrict the edge to **relative import/require specifiers in code
  files** (`import x from '…'`, `import('…')`, `require('…')` in `.js`/`.mjs`/`.ts`-family
  sources, matched across line breaks), resolved as **module edges**: file-relative only with
  extension/index completion, no bare or root-relative strings, no name/unique-filename layers,
  and an index-less directory import is breakage rather than a crossing. Prose, docs, and
  comments stay free to mention — or quote paths into — the barred folders; the coupling class
  this scope polices is the one that crashes at runtime. Default is every resolvable reference;
  incompatible with `matchNames` (a text layer an imports-only edge excludes by definition).
- **`allow: [...]`** (or a single `"allow": "shared"`) — folders reachable despite the ban (a `shared`/`contracts` folder both sides may use). Always implicitly allowed: references *within* the guarded region itself.
- **`matchNames: true`** — opt into the **bare-name layer**: the barred folders' own names are matched as bare words too (see below). `alsoMatchNames: [...]` force-includes non-distinctive names.
- **`matchUniqueFilenames: false`** — opt *out* of the unique-basename layer (on by default). A bare `filename.ext` then resolves only through the path attempts, so a **convention marker** (a filename many folders are meant to carry but only one does yet — `checks.mjs`, `RELEASE.md`) no longer reads as a coupling to that lone folder. Path references and distinctive names still fire.
- **`except: [...]`** — the rule's own exceptions (see [Exceptions](#exceptions-carve-outs-and-reviewed-crossings)).
- **`reason`** — surfaced as the finding's *why*.

Paths are repo-relative prefixes; both `/` and `\` separators are accepted. A malformed rule — overlapping `from`/`to`, an empty prefix, an unknown property — is a blocking `config` finding, not a silent no-op.

### The whole-repo form

`from: "."` guards the entire repo, carved down by `except` carve-out strings. It is the safe-by-default posture (a new top-level file is guarded until excepted), at the cost of listing the content trees to subtract:

```json
{ "from": ".", "to": "plugins/*", "matchNames": true,
  "except": ["plugins/*", "plugins/README.md"],
  "reason": "the host must not know the specific plugins it loads" }
```

The repo root must be spelled `.` explicitly (`""`/`"/"` are rejected as likely typos), and every barred target must lie inside a carve-out — otherwise the self-reference rule would exempt it, so the rule is rejected as a `config` error rather than silently under-enforcing. Choose between the two postures per rule: an **explicit `from` list** reads as "here is what's core" and drops catalogs/config for free but leaves a new top-level folder unguarded until listed; **`from: "."`** guards everything by default but needs the content trees carved out.

## How detection works — the tree is the oracle

The unit of detection is *a reference that resolves to a real tracked path inside the barred folder*. That single rule is what makes it language-agnostic and precise:

1. **Candidate extraction** — on every line of every guarded file (comments and Markdown included): quoted strings (import specifiers, `require()`, `@import`, config values, JSON) **and** unquoted path-ish tokens. Test files (`*.test.mjs`) are never scanned — a test references what it tests, so a core test naming content is expected, not a coupling.
2. **Resolution against the repo tree** — a candidate resolves via, in order: file-relative (`../server/db.js`, `..\server\db.js`), repo-root-relative (`server/db.js`), Python-style *absolute* dotted module (`import server.pkg.mod` → `server/pkg/mod.py`), then the unique-basename layer. Slash paths get extension/index completion (`../server/db` → `server/db.ts`, `../server` → `server/index.ts`, `../server/theme` → `server/_theme.scss`). The dotted-module attempt completes with **Python extensions only** (`.py`/`__init__.py`) — dotted notation is a Python/JVM module convention, so a JS `receiver.method()` call is never mistaken for a `receiver/method.js` module reference. A **bare `filename.ext`** resolves only when exactly one tracked file carries that basename — unique → no collision → no false positive.
3. **Verdict** — a candidate that resolves to a path under `to` (and not into the guarded region itself or an `allow` folder) is a crossing. A word that merely *looks like* a folder name — `"the API server is remote"`, a `https://server/...` URL, a `store.dispatch()` call — resolves to nothing and never fires.

**The bare-name layer** (opt-in, `matchNames: true`): a barred folder's own *name* is matched as a bare word — in prose, a backtick cite, a string literal — and resolves to that folder. This catches identifier-level coupling (a hardcoded folder name that no path ever spells out), so it is restricted to **distinctive** names, ones containing `-` or `_`, which ordinary prose never produces; a plain-word name (`server`, `basics`) is matched only when the edge force-includes it via `alsoMatchNames`. A name inside a longer token (`tidy-repo-seed.mjs`) or a URL path never fires. An `alsoMatchNames` entry naming no barred folder is a blocking `config` finding.

**In scope for v1:** imports and path strings that resolve into the barred folder, plus unique `filename.ext` mentions — anywhere, comments and docs included — plus opted-in bare names. Vendored/generated files are excluded automatically (the runner drops them from `ctx.files`).

### Known limitations

The engine is **best-effort for imports and precise (no false positives) by design** — it would rather miss an exotic reference form than block on a guess. It does *not* resolve, and so does not catch, these crossings (a follow-up may add them; each needs real per-language handling):

- **Plain-word folder names** in prose (`"see the server module"`). Distinctive names are the `matchNames: true` layer's job; single ordinary words are only matched when force-included via `alsoMatchNames`, because English can't be told apart from an identifier.
- **Class/function symbol references** (a `from`-file *using* a symbol *defined* in `to`). Needs per-language symbol extraction and resolution.
- **Python *relative* imports** (`from ..server import x`) and **`from x import y`** name imports. Only the absolute dotted form (`import server.x`) resolves today.
- **Alias imports** (`@/server/db`, `~/server/db`, tsconfig/webpack `paths`). The engine has no project alias map.
- **Rust `::` paths** (`use crate::server::db;`).
- **Case-only differences** on case-insensitive filesystems (`../Server/db.js`). Matching is case-sensitive — the same behavior a Linux CI runtime has.

One precision caveat cuts the other way: the unique-basename layer can resolve a **convention marker name** (a `RULES.md`-like filename every sibling is *meant* to carry) while only one folder happens to carry it yet. Such a hit is a false coupling — set **`matchUniqueFilenames: false`** on the rule to turn the layer off (path references and distinctive names still fire), or, if you want to keep the layer for other files, accept the one crossing with an exception whose reason says so.

## Exceptions: carve-outs and reviewed crossings

A rule's `except` array holds two kinds of entry, and a rule owns both — there is no separate top-level accept list.

**Carve-out strings** subtract files from the guarded region — they are not scanned, *and* references to them stop counting as self-references (the mechanism that makes `from: "."` coherent). Entries are folders/files, `"<folder>/*"` child-directory globs, or `"*.suffix"` name patterns:

```json
"except": ["plugins/*", "plugins/README.md", "*.generated.js"]
```

**Reviewed exceptions** `{ path, to?, reason }` excuse a deliberate crossing, reviewed once like any code:

```json
"except": [
  { "path": "engine/registry.js", "to": ["plugins/legacy"],
    "reason": "temporary bridge during the plugin split — tracked in #123" },
  { "path": "docs/inventory.md",
    "reason": "historical ledger — it enumerates the plugins it catalogs by name" }
]
```

- **`path`** — one file, or a subtree with a trailing `/`.
- **`to`** — the barred folder(s) this file may reference. **With `to`**, the exception is *pinned*: a crossing from that file to a *different* barred folder still fails, so no new coupling slips into an already-reviewed file. **Without `to`**, it excuses every crossing from that file — a whole-file exemption for a genuinely enumerative file (a ledger), carrying a reason a bare carve-out string can't.
- **`reason`** — required. It is what makes the crossing reviewable.

On a whole-repo sweep with a clean config, an exception that matched **nothing** is itself a blocking finding: the coupling it excused is gone, so the entry (or the unused `to` item) gets pruned instead of rotting. Shrinking a rule's reviewed exceptions to none is the definition of "the graph holds."

(The runner's generic top-level `accept` — `{ "rule": "barrier", "path": "...", "reason": "..." }` — still works too, retiring *every* barrier finding in a file. Prefer a rule's own `except`: it is pinned per target and staleness-audited, where the generic accept is a silent whole-file waiver.)

## Composing a barrier from another pack

A pack ships a *fixed* barrier — no project config needed — by **declaring** this pack and **contributing** the barrier as data on its manifest, never by importing this pack's code (`pack-independence`): name `barriers` in the pack's `requires` and carry the barrier under `contributes`:

```js
// packs/<somepack>/pack.mjs
export default {
  id: 'somepack',
  requires: ['barriers'],
  contributes: {
    barriers: [{
      id: 'requirements-isolation',
      edges: [{ from: 'dev/requirements', to: '*', reason: 'requirements is a pure sink' }],
    }],
  },
};
```

Each contribution becomes a **first-class rule under its own id** — per-rule overrides (`rules: { "requirements-isolation": "off" }`) and acceptances address it directly, and `description`/`why`/`doc`/`severity`/`crossingExcuse` ride the contribution. `gateDir` is the one declarative gate: the rule stays inert until that directory exists in the repo under test (how the baseline's consumer-isolation wall stays quiet pre-flip). The runner hands this pack the active-pack list (`contributedRules` on its manifest, the generic core seam), and [contributed.mjs](contributed.mjs) builds the rules — an undeclared pack contributes nothing, exactly as its own rules would not run. A consumer's local pack contributes the same way. A helper a pack needs beside a barrier (path containment, say) lives in the engine lib (`engine/checks/helpers/path-containment.mjs`), never in this pack's modules.
