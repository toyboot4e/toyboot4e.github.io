# Third-party licenses — vendored grammars & queries

The files under `wasm/` and `queries/` are vendored from third-party projects
(produced by `vendor.sh`; see `MANIFEST.txt` for exact sources + revisions).
They are build-time inputs only — they are **not** served to site visitors (the
generated HTML/CSS in `out/` contains none of them), so the published site is not
a derivative of them.

> Not legal advice — a plain-language summary of the upstream licenses.

## Highlight queries — `queries/*.scm`

Sourced from **Helix** (`helix-editor/helix`, `runtime/queries/`), licensed
**MPL-2.0** (Mozilla Public License 2.0): https://github.com/helix-editor/helix/blob/master/LICENSE

MPL-2.0 is file-level copyleft: these `.scm` files stay under MPL-2.0 and their
source remains available here in the repo; it imposes no license requirement on
the rest of this project or on the generated site.

Exception: `queries/*.local.scm` are our own additions (see headers in those
files), not from Helix.

## Grammars — `wasm/*.wasm`

Each is a grammar compiled to WebAssembly from the repository + revision listed
in `MANIFEST.txt`. Licenses:

- **MIT** — all grammars except the one below (tree-sitter, tree-sitter-grammars,
  numtide, stadelmanma, rydesun, Wilfred, …).
- **Apache-2.0** — `ini` (`justinmk/tree-sitter-ini`).

Refer to each upstream repository (in `MANIFEST.txt`) for the full license text
and copyright notices.
