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
    # Refresh `linkcard-cache.json` (bun runs the .ts directly -- no .module.css here):
    -cd builder && bun src/fetch-linkcards.ts
    # Bundle the build to dist/ only when a source is newer than it (else reuse the
    # bundle), then run the plain JS under bun -- no per-process vite-node boot.
    cd builder && if [ ! -f dist/main.js ] || [ -n "$(find src config-shared.ts vite.build.config.ts vite.config.ts -newer dist/main.js 2>/dev/null)" ]; then bunx vite build -c vite.build.config.ts; fi
    cd builder && bun dist/main.js {{args}}

[private]
alias b := build

# cleans up the output directory + the cached build bundle
clean:
    echo "cleaning up the \`out/\` directory + \`builder/dist\` bundle.."
    rm -rf out/* builder/dist > /dev/null 2>&1

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
    cd builder && ASSETS_CLI=1 bunx vite-node src/assets.ts

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

# ── accessibility ──────────────────────────────────────────────────────────
# axe-core over EVERY built page, in BOTH themes, in headless chromium. This is
# the main a11y gate: Lighthouse (`just audit`) only samples one page and runs a
# subset of the rules. Needs `out/` built. Exits non-zero on a serious+ finding.
#   just a11y                 # whole site, WCAG 2.0/2.1/2.2 A+AA
#   just a11y --sample        # one page per template + the feature-heaviest ones
#   just a11y --all           # + advisory best-practice rules
#   just a11y index.html      # just these pages
#   just a11y --theme=dark --json
a11y *args:
    cd scripts/a11y && bun install --silent
    bun scripts/a11y/a11y.ts scan {{args}}

[private]
alias a11 := a11y

# What a screen reader is actually handed, in reading order: roles, accessible
# names and heading levels straight from chromium's accessibility tree. Read this
# before and after any markup change -- it catches the things axe cannot, like an
# unnamed landmark or a run of links with no list around it.
a11y-tree page="index.html" *args:
    cd scripts/a11y && bun install --silent
    bun scripts/a11y/a11y.ts tree {{page}} {{args}}

# Walk the page with Tab like a keyboard-only user: what takes focus, in what
# order, under what name, and whether it shows a focus ring.
a11y-tab page="index.html" *args:
    cd scripts/a11y && bun install --silent
    bun scripts/a11y/a11y.ts tab {{page}} {{args}}

# One row per syntax-highlight bucket with its measured contrast ratio, per
# theme. Run this after touching either `.hl` palette in style.css -- axe reports
# the same handful of palette entries as thousands of nodes.
a11y-contrast *args:
    cd scripts/a11y && bun install --silent
    bun scripts/a11y/a11y.ts contrast {{args}}

# warm watch daemon + live preview: one full build at startup, then keep the
# render+bake machinery resident and rebuild ONLY the changed file on each save
# (~10-50ms vs ~1.5s for a full build). Also serves out/ on {{port}} with
# Vite-style live reload — the browser refreshes the moment a rebuild lands (CSS
# edits hot-swap without navigating). Release-only (drafts are skipped); the
# reload client is injected at serve time, so out/ stays the byte-exact release
# output. Set DEV_PORT=0 to disable the server and preview with `just serve`.
watch:
    # the daemon's startup build spawns the bundled dist/render-shard.js, so build it first
    cd builder && bunx vite build -c vite.build.config.ts
    cd builder && DEV_PORT={{port}} bunx vite-node src/watch.ts

[private]
alias w := watch

ci *args:
    pinact run -update
    zizmor .

# converts image files into webp in-place
to-webp:
    bun scripts/to-webp.ts
