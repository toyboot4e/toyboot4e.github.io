#!/usr/bin/env bash
# Bundle + minify hand-written TypeScript in src/style/ into *.min.js. Mirrors
# scripts/min-css.sh (which does the same for CSS via esbuild). Invoked via
# `bash scripts/build-js.sh` (by `just build-js`) so it works even where
# `/usr/bin/env` is absent, e.g. the hermetic nix build sandbox. esbuild
# transpiles TS natively and bundles offline — no new dependency, no network.
#
# The org-publish "static" component copies the resulting `*.min.js` into
# `out/style/` by extension; the `.ts` source is not matched, so only the
# compiled output ships. The generated `*.min.js` is committed, like `*.min.css`.
set -euo pipefail

for f in disco; do
    esbuild "src/style/$f.ts" --bundle --minify --target=es2017 \
        --outfile="src/style/$f.min.js" --log-level=warning
    echo "  $f.ts -> $f.min.js ($(wc -c <"src/style/$f.ts") -> $(wc -c <"src/style/$f.min.js") bytes)"
done
