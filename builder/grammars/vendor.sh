#!/usr/bin/env bash
# Vendor tree-sitter grammars + highlight queries, all from Helix's curated set so
# grammar and queries always match. For each language we:
#   1. compile the grammar (at Helix's pinned git rev) to WebAssembly with the
#      tree-sitter CLI — at the SAME version as the committed web-tree-sitter
#      runtime, or Language.load fails with a dylink/ABI error;
#   2. copy Helix's highlights.scm / locals.scm / injections.scm.
# Outputs (committed; the hermetic site build only READS them):
#   wasm/<id>.wasm   queries/<id>.scm   queries/<id>.locals.scm   queries/<id>.injections.scm
#
# Why Helix: its queries target the official `tree-sitter-highlight` algorithm
# that highlight.ts implements (last-pattern-wins + locals scope resolution +
# injections), and it curates them (e.g. disabling broad fallback patterns that
# would otherwise mislabel everything). Grammar revs come from Helix's
# languages.toml so node types line up with the queries.
#
# Needs network + a one-time wasi-sdk download (cached in ~/.cache/tree-sitter).
# The tree-sitter CLI is pulled via npx (pinned in TS_CLI), NOT a package.json dep
# (its postinstall fetches a native binary that would break the hermetic nix build).
# Re-run to add/bump a language; commit the regenerated files. `validate.mjs`
# checks every query still compiles against its grammar.
#
# Exception: `org` is pinned NEWER than Helix's languages.toml rev. Helix's pinned
# org grammar ships a C++ scanner (scanner.cc, std::vector) that the tree-sitter
# Wasm sandbox rejects ("uses a symbol that isn't available to Wasm parsers"); the
# newer milisims rev rewrote the scanner in C (wasm-safe). Node types still match
# Helix's org queries.
set -uo pipefail
cd "$(dirname "$0")" # builder/grammars
TS_CLI="tree-sitter-cli@0.26.9" # keep matching web-tree-sitter in package.json
TS="npx --yes $TS_CLI"
HELIX_REF="master" # Helix queries are stable; re-running may pull newer curation
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p wasm queries

# id | grammar repo | git rev | grammar subpath | helix query dir
GRAMMARS="
haskell|tree-sitter/tree-sitter-haskell|0975ef72fc3c47b530309ca93937d7d143523628||haskell
bash|tree-sitter/tree-sitter-bash|a06c2e4415e9bc0346c6b86d401879ffb44058f7||bash
nix|numtide/tree-sitter-nix|70f34e95e30b7ebcc40815d4385d68576c4a15cd||nix
rust|tree-sitter/tree-sitter-rust|77a3747266f4d621d0757825e6b11edcbf991ca5||rust
lua|tree-sitter-grammars/tree-sitter-lua|10fe0054734eec83049514ea2e718b2a56acd0c9||lua
typescript|tree-sitter/tree-sitter-typescript|75b3874edb2dc714fb1fd77a32013d0f8699989f|typescript|typescript
tsx|tree-sitter/tree-sitter-typescript|75b3874edb2dc714fb1fd77a32013d0f8699989f|tsx|tsx
javascript|tree-sitter/tree-sitter-javascript|58404d8cf191d69f2674a8fd507bd5776f46cb11||javascript
json|tree-sitter/tree-sitter-json|001c28d7a29832b06b0e831ec77845553c89b56d||json
css|tree-sitter/tree-sitter-css|dda5cfc5722c429eaba1c910ca32c2c0c5bb1a3f||css
html|tree-sitter/tree-sitter-html|73a3947324f6efddf9e17c0ea58d454843590cc0||html
toml|tree-sitter-grammars/tree-sitter-toml|64b56832c2cffe41758f28e05c756a3a98d16f41||toml
yaml|tree-sitter-grammars/tree-sitter-yaml|a1c4812a73ec5e089de8e441fdea3a921e8d5079||yaml
python|tree-sitter/tree-sitter-python|293fdc02038ee2bf0e2e206711b69c90ac0d413f||python
php|tree-sitter/tree-sitter-php|3f2465c217d0a966d41e584b42d75522f2a3149e|php|php
c|tree-sitter/tree-sitter-c|b780e47fc780ddc8da13afa35a3f4ed5c157823d||c
cpp|tree-sitter/tree-sitter-cpp|8b5b49eb196bec7040441bee33b2c9a4838d6967||cpp
csharp|tree-sitter/tree-sitter-c-sharp|cac6d5fb595f5811a076336682d5d595ac1c9e85||c-sharp
fortran|stadelmanma/tree-sitter-fortran|2880b7aab4fb7cc618de1ef3d4c6d93b2396c031||fortran
makefile|alemuller/tree-sitter-make|a4b9187417d6be349ee5fd4b6e77b4172c6827dd||make
emacs-lisp|Wilfred/tree-sitter-elisp|29b4e49275f4a947ce17c8533bc20a1f97768c70||elisp
ini|justinmk/tree-sitter-ini|e4018b5176132b4f3c5d6e61cea383f42288d0f5||ini
dot|rydesun/tree-sitter-dot|917230743aa10f45a408fea2ddb54bbbf5fbe7b7||dot
markdown|tree-sitter-grammars/tree-sitter-markdown|f969cd3ae3f9fbd4e43205431d0ae286014c05b5|tree-sitter-markdown|markdown
markdown_inline|tree-sitter-grammars/tree-sitter-markdown|f969cd3ae3f9fbd4e43205431d0ae286014c05b5|tree-sitter-markdown-inline|markdown.inline
commonlisp|tree-sitter-grammars/tree-sitter-commonlisp|32323509b3d9fe96607d151c2da2c9009eb13a2f||common-lisp
org|milisims/tree-sitter-org|64cfbc213f5a83da17632c95382a5a0a2f3357c1||org
"

# Shared base ("pseudo") query sets that have NO grammar of their own: other
# languages pull them in via `; inherits:` (resolved in highlight.ts's readQuery).
# e.g. javascript -> ecma,_javascript; tsx -> ecma,_typescript,_jsx. Without these
# the js/ts/tsx highlights.scm are nearly empty (just a few language-specific rules)
# and almost nothing highlights. We fetch their highlights/locals/injections under
# the SAME `<base>.scm` naming the grammars use, so `; inherits:` finds them.
# (`c` is a real grammar above, so cpp's `; inherits: c` already resolves.)
BASE_QUERIES="ecma _javascript _typescript _jsx"

ok=0; fail=0; manifest=""
echo "Vendoring grammars with $($TS --version)…"
while IFS='|' read -r id repo rev sub hx; do
  [ -z "$id" ] && continue
  # 1. grammar -> wasm (from Helix's pinned rev)
  curl -sL "https://github.com/$repo/archive/$rev.tar.gz" | tar xz -C "$TMP" 2>/dev/null
  gdir="$TMP/$(basename "$repo")-$rev${sub:+/$sub}"
  [ -f "$gdir/src/parser.c" ] || ( cd "$gdir" && $TS generate >/dev/null 2>&1 )
  if $TS build --wasm -o "$(pwd)/wasm/$id.wasm" "$gdir" >/dev/null 2>&1; then
    : # built
  else
    echo "  ✗ $id (build failed)"; fail=$((fail+1)); continue
  fi
  # 2. Helix queries
  base="https://raw.githubusercontent.com/helix-editor/helix/$HELIX_REF/runtime/queries/$hx"
  curl -sf "$base/highlights.scm" -o "queries/$id.scm" || { echo "  ✗ $id (no highlights)"; fail=$((fail+1)); continue; }
  curl -sf "$base/locals.scm" -o "queries/$id.locals.scm" 2>/dev/null || rm -f "queries/$id.locals.scm"
  curl -sf "$base/injections.scm" -o "queries/$id.injections.scm" 2>/dev/null || rm -f "queries/$id.injections.scm"
  echo "  ✓ $id ($(($(stat -c%s "wasm/$id.wasm")/1024))KB)"
  manifest+="$id  $repo@${rev:0:10}  helix:$hx\n"
  ok=$((ok+1))
done <<< "$GRAMMARS"

# Grammar-less base query sets pulled in via `; inherits:` (see BASE_QUERIES note).
echo "Fetching shared base query sets (inherited via \`; inherits:\`)…"
for base in $BASE_QUERIES; do
  hb="https://raw.githubusercontent.com/helix-editor/helix/$HELIX_REF/runtime/queries/$base"
  curl -sf "$hb/highlights.scm" -o "queries/$base.scm" || { echo "  ✗ $base (no highlights)"; fail=$((fail+1)); continue; }
  curl -sf "$hb/locals.scm" -o "queries/$base.locals.scm" 2>/dev/null || rm -f "queries/$base.locals.scm"
  curl -sf "$hb/injections.scm" -o "queries/$base.injections.scm" 2>/dev/null || rm -f "queries/$base.injections.scm"
  echo "  ✓ $base (base queries)"
  manifest+="$base  (base queries)  helix:$base\n"
done

echo
echo "Done: $ok ok, $fail failed."
printf "$manifest" | sort > MANIFEST.txt
echo "Manifest -> grammars/MANIFEST.txt  (ditaa/plantuml have no grammar -> plain text)"
