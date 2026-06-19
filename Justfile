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

# build the devlog (-d --draft, -f --force): build assets, fetch link cards,
# export with Emacs, then format and postprocess
build *args:
    @just assets
    # Generate `linkcard-cache.json`, dismissing errors:
    -bun scripts/fetch-linkcards.ts
    emacs -Q --script "./build.el" -- {{args}}
    @just format

[private]
alias b := build

# cleans up the output directory
clean:
    echo "cleaning up the \`out/\` directory.."
    rm -rf out/* > /dev/null 2>&1
    # force rebuild in the next `just build`:
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

# start watching source files and runs `build` on change
watch *args:
    #!/usr/bin/env bash
    echo "start watching.."
    exts="el,org,css,scss,ts,js,webp,png,jpg,jpeg,gif,svg"
    ig=(--ignore 'index.org' --ignore '**/tags/**' --ignore '**/ltximg/**' --ignore '**/*.min.css' --ignore '**/*.min.js')
    if [[ "${1:-}" == "-d" || "${1:-}" == "--draft" ]] ; then
        echo "draft build"
        watchexec -e "$exts" -w src "${ig[@]}" "just build --draft"
    elif [[ -z "${1:-}" || "${1:-}" == "-r" || "${1:-}" == "--release" ]] ; then
        echo "release build"
        watchexec -e "$exts" -w src "${ig[@]}" "just build --release"
    else
        echo "invalid option"
    fi

[private]
alias w := watch

ci *args:
    pinact run -update
    zizmor .

# converts image files into webp in-place
to-webp:
    bun scripts/to-webp.ts
