#!/usr/bin/env bash
# Bake Prism / KaTeX / link-cards into the freshly built HTML
# (scripts/postprocess.ts), skipping files already stamped with the `<!--pp-->`
# sentinel. postprocess re-serialises every page through linkedom, so it is the
# sole HTML serialiser — there is no separate Prettier pass (it was ~0.15s, its
# indentation was re-emitted by linkedom anyway, and dropping it removes a build
# dependency plus the "format before the bake so KaTeX isn't reflowed" foot-gun).
# Invoked via `bash scripts/format.sh` (by `just format`) so it works without
# `/usr/bin/env`, e.g. in the hermetic nix build sandbox. CI=1 -> strict.
set -euo pipefail

mapfile -t files < <(grep -rL --include='*.html' -- '<!--pp-->' out 2>/dev/null || true)
if [ "${#files[@]}" -eq 0 ]; then
    echo "post: nothing to bake"
    exit 0
fi
echo "post: baking ${#files[@]} file(s).."
bun scripts/postprocess.ts "${files[@]}"
