#!/usr/bin/env bash
# Prettier-format then bake Prism / KaTeX / link-cards into the freshly built
# HTML (scripts/postprocess.ts). Both steps skip files already stamped with the
# `<!--pp-->` sentinel. Prettier runs first so it never reflows KaTeX markup.
# Invoked via `bash scripts/format.sh` (by `just format`) so it works without
# `/usr/bin/env`, e.g. in the hermetic nix build sandbox. CI=1 -> strict.
set -euo pipefail

mapfile -t files < <(grep -rL --include='*.html' -- '<!--pp-->' out 2>/dev/null || true)
if [ "${#files[@]}" -eq 0 ]; then
    echo "post: nothing to bake"
    exit 0
fi
echo "post: formatting + baking ${#files[@]} file(s).."
prettier --print-width 100 --write "${files[@]}" >/dev/null
bun scripts/postprocess.ts "${files[@]}"
