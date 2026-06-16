#!/usr/bin/env bash
# Minify the hand-written CSS in src/style/ into *.min.css. Invoked via
# `bash scripts/min-css.sh` (by `just min-css`) so it works even where
# `/usr/bin/env` is absent, e.g. the hermetic nix build sandbox.
set -euo pipefail

for f in style prism-dark prism-light; do
    esbuild "src/style/$f.css" --minify --outfile="src/style/$f.min.css" --log-level=warning
    echo "  $f.css -> $f.min.css ($(wc -c <"src/style/$f.css") -> $(wc -c <"src/style/$f.min.css") bytes)"
done
