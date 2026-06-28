# Vendored tree-sitter grammars + queries

Syntax highlighting is done at build time by **web-tree-sitter** (see
`../src/highlight.ts`), which implements the official `tree-sitter-highlight`
algorithm — the one Helix and GitHub use. Each language needs a compiled grammar
plus its query files, all committed and all produced by `vendor.sh`:

- **`wasm/<id>.wasm`** — the grammar compiled to WebAssembly with the tree-sitter
  CLI, at the SAME version as the `web-tree-sitter` runtime in `package.json`
  (the ABI must match, or `Language.load` fails with a dylink error).
- **`queries/<id>.scm`** — `highlights.scm`: capture names → colour buckets
  (`hl-*` CSS classes), mapped in `highlight.ts`'s `CLASS_TABLE`.
- **`queries/<id>.locals.scm`** — `locals.scm` (when the language has one): scope
  resolution. A `@local.reference` reuses the highlight of its
  `@local.definition`, so genuine local variables aren't mislabeled by broad
  fallback patterns. **This is what makes highlighting *semantic*** (e.g. a
  haskell function name coloured as a function, a bound variable left plain).
- **`queries/<id>.injections.scm`** — `injections.scm` (when present): a
  sub-region re-highlighted with another grammar (makefile recipe → bash,
  markdown → markdown_inline, fenced code block → its language).

Everything comes from **Helix's curated query set** (`runtime/queries/`), because
those queries target this exact algorithm (last-pattern-wins precedence +
locals + injections) and Helix curates them — e.g. it disables broad fallback
patterns like `(variable) @type` that would otherwise paint everything one
colour. Grammar revisions come from Helix's `languages.toml` so the grammars'
node types line up with the queries. `<id>` is the canonical grammar id; org
language tokens (`hs`, `sh`, `ts`, `md`, `lisp`, …) alias onto it via `ALIAS` in
`highlight.ts`. `MANIFEST.txt` records each id's grammar source + rev.

### `; inherits:` and shared base queries

Helix's js/ts/tsx (and cpp) query files are thin: they start with a
`; inherits: ecma,_javascript`-style directive and keep only the
language-specific rules, sharing the bulk via base "pseudo-languages" (`ecma`,
`_javascript`, `_typescript`, `_jsx`) that have query files but **no grammar**.
`highlight.ts`'s `readQuery` resolves the directive exactly as Helix does —
splicing the inherited file's contents in place, recursively, same kind
(highlights/locals/injections) — so the language's own (more specific) patterns
still come last (last-wins). `vendor.sh` fetches those base sets (`BASE_QUERIES`)
under the same `<base>.scm` naming. **Forgetting either half** (the base files or
the resolution) leaves js/ts/tsx with almost no highlighting even though the
build reports no error — the thin query compiles fine, it just matches nothing.

## Re-vendoring

`vendor.sh` is the source of truth — run it to add/bump a language (edit its
`GRAMMARS` table), then commit the regenerated `wasm/` + `queries/` +
`MANIFEST.txt`. It needs network and pulls the tree-sitter CLI on demand via
`npx` (pinned in `TS_CLI`); the CLI is deliberately NOT a `package.json`
dependency, because its postinstall downloads a native binary that would break
the hermetic (offline) nix build. The first run downloads a wasi-sdk toolchain
(cached in `~/.cache/tree-sitter`).

`validate.mjs` loads every grammar + its combined query in the web-tree-sitter
runtime and reports any that fail to compile (catches grammar/query version
skew) plus the union of capture names (to spot a new name needing a `CLASS_TABLE`
bucket). Run it after re-vendoring.

The hermetic site build only READS these files; it never runs `vendor.sh`.

## Not highlighted

`ditaa` and `plantuml` have no grammar here and render as plain text (same
`.hl` / `.line` framing, no colour) — see the `PLAIN` set in `../src/bake.ts`.

`org` IS highlighted (`org.wasm` + Helix's org queries). Note its grammar is
pinned NEWER than Helix's `languages.toml` rev: Helix's pinned org grammar has a
C++ scanner (`scanner.cc`, `std::vector`) the tree-sitter Wasm sandbox rejects;
the newer milisims rev rewrote the scanner in C (wasm-safe), with node types that
still match Helix's org queries. `org`'s `injections.scm` re-highlights each
`#+BEGIN_SRC <lang>` body with `<lang>`, so an org sample colours its nested code.
