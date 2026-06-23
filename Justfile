# Just a task runner
# <https://github.com/casey/just>

set positional-arguments

# Use bash for recipe lines (for Nix sandbox)
set shell := ["bash", "-cu"]

port := "8080"
lh_report := "/tmp/lh-report" # {{lh_report}}.report.{html,json}`

# shows this help message
help:
    @just -l

# build the devlog into out/ -- this is what nix/CI ship. Builds assets, fetches
# link cards (best-effort), then renders AND bakes (Prism/KaTeX/cards) via the
# Vite builder (`builder/`, vite-node). BUILD_PROF=1 prints phase timings.
build *args:
    @just assets
    # Refresh `linkcard-cache.json`, dismissing errors (offline/CI just reads it):
    -cd builder && bunx vite-node src/fetch-linkcards.ts
    cd builder && bunx vite-node src/main.ts {{args}}

[private]
alias b := build

# cleans up the output directory
clean:
    echo "cleaning up the \`out/\` directory.."
    rm -rf out/* > /dev/null 2>&1

# run the golden tests (render+bake output pinned against test/golden/).
# regenerate goldens after an intentional output change: `just test-update`
test:
    cd builder && bunx vitest run

[private]
alias t := test

# regenerate golden files, then show the diff to review
test-update:
    cd builder && UPDATE_GOLDEN=1 bunx vitest run
    git -c core.pager=cat diff --stat builder/test/golden/

[private]
alias c := clean

# fetch OGP metadata for `[[card:URL]]` links into `linkcard-cache.json` (-f, URLs)
linkcards *args:
    cd builder && bunx vite-node src/fetch-linkcards.ts {{args}}

[private]
alias lc := linkcards

# build CSS modules (-> components.min.css) + minify CSS + bundle/minify TS in
# `src/style/` into `*.min.{css,js}` via the Vite builder (also run by `build`)
assets:
    cd builder && bunx vite-node src/assets.ts

# starts HTTP server
serve:
    cd out && python3 -m http.server {{port}}

[private]
alias s := serve

# audit a built page with Lighthouse (requires local server at {{port}})
audit page="index.html":
    #!/usr/bin/env bash
    set -euo pipefail
    if ! curl -sf -o /dev/null "http://localhost:{{port}}/{{page}}" ; then
        echo "no server on :{{port}} — run \`just serve\` in another shell first" >&2
        exit 1
    fi
    CHROME_PATH="$(command -v chromium)" npx --yes lighthouse@latest \
        "http://localhost:{{port}}/{{page}}" \
        --quiet --output=html --output=json --output-path={{lh_report}} \
        --chrome-flags="--headless=new --no-sandbox --disable-gpu" \
        --only-categories=performance,accessibility,best-practices,seo
    echo "report: {{lh_report}}.report.html"

[private]
alias a := audit

# audit, then open the HTML report in a browser
audit-open page="index.html": (audit page)
    xdg-open {{lh_report}}.report.html

[private]
alias ao := audit-open

# audit, then print a compact, agent-friendly summary from the report JSON
audit-ai page="index.html": (audit page)
    bun scripts/audit-summary.ts {{lh_report}}.report.json

# warm watch daemon: one full build at startup, then keep the render+bake
# machinery resident and rebuild ONLY the changed file on each save (~10-50ms vs
# ~1.5s for a full build). Release-only (drafts are skipped). Run `just serve`
# alongside to preview.
watch:
    cd builder && bunx vite-node src/watch.ts

[private]
alias w := watch

ci *args:
    pinact run -update
    zizmor .

# converts image files into webp in-place
to-webp:
    bun scripts/to-webp.ts
