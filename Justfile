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

# build the devlog (uniorg/bun, no Emacs) into out/ -- this is what nix/CI ship.
# Builds assets, fetches link cards (best-effort), then renders AND bakes
# (Prism/KaTeX/cards) across worker threads in one pass. BUILD_WORKERS=N caps the
# worker count; BUILD_PROF=1 prints timings.
build *args:
    @just assets
    # Refresh `linkcard-cache.json`, dismissing errors (offline/CI just reads it):
    -bun scripts/fetch-linkcards.ts
    bun build.ts {{args}}

# Emacs reference build (build.el + ox-slimhtml) into out-emacs/, for
# side-by-side comparison with the default bun build. Exports with Emacs, then
# bakes via scripts/postprocess.ts (-d --draft, -f --force passed through).
build-emacs *args:
    @just assets
    -bun scripts/fetch-linkcards.ts
    OUT_DIR=out-emacs emacs -Q --script "./build.el" -- {{args}}
    OUT_DIR=out-emacs just format

[private]
alias be := build-emacs

[private]
alias b := build

# cleans up the output directories
clean:
    echo "cleaning up the \`out/\` and \`out-emacs/\` directories.."
    rm -rf out/* out-emacs/* > /dev/null 2>&1
    # force a full rebuild of the Emacs reference build next time:
    rm -rf .org-timestamps

[private]
alias c := clean

# run the post-processing script (Prism/KaTeX/link-card bake + serialise),
# embedding the `<!--pp-->` sentinel. CI=1 makes the post-process strict.
format:
    bash scripts/format.sh

[private]
alias fmt := format

[private]
alias f := format

# fetch OGP metadata for `[[card:URL]]` links into `linkcard-cache.json` (-f, URLs)
linkcards *args:
    bun scripts/fetch-linkcards.ts {{args}}

[private]
alias lc := linkcards

# minify CSS + bundle/minify TS in `src/style/` into `*.min.{css,js}` (also run by `build`)
assets:
    bun scripts/build-assets.ts

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

# watch source files and run the (fast bun) `build` on change. The bun build is
# release-only (no draft/ support); use `just build-emacs --draft` for drafts.
watch:
    #!/usr/bin/env bash
    echo "start watching.."
    exts="org,css,scss,ts,js,webp,png,jpg,jpeg,gif,svg"
    ig=(--ignore 'index.org' --ignore '**/tags/**' --ignore '**/ltximg/**' --ignore '**/*.min.css' --ignore '**/*.min.js')
    watchexec -e "$exts" -w src "${ig[@]}" "just build"

[private]
alias w := watch

ci *args:
    pinact run -update
    zizmor .

# converts image files into webp in-place
to-webp:
    bun scripts/to-webp.ts
