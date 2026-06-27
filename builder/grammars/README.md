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

`org`, `ditaa` and `plantuml` have no grammar here and render as plain text (same
`.hl` / `.line` framing, no colour) — see the `PLAIN` set in `../src/bake.ts`.
