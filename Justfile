# Just a task runner
# <https://github.com/casey/just>

set positional-arguments
# Use bash for recipe lines (always present, incl. the nix build sandbox, where
# `/usr/bin/env` for `#!`-shebang recipes is not).
set shell := ["bash", "-cu"]

# shows this help message
help:
    @just -l

# build the devlog (-d --draft, -f --force): minify CSS, fetch link cards,
# export with Emacs, then format and postprocess
build *args:
    @just min-css
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

# format (Prettier) + bake in Prism/KaTeX (scripts/postprocess.ts) the freshly
# built HTML. Both steps skip files already stamped with the `<!--pp-->`
# sentinel. CI=1 makes the post-process strict.
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

# minify hand-written CSS in `src/style/` into `*.min.css` (also run by `build`)
min-css:
    bash scripts/min-css.sh

# starts HTTP server
serve:
    cd out && python3 -m http.server 8080

[private]
alias s := serve

# audit a built page with Lighthouse (needs `just serve` running)
audit page="index.html":
    #!/usr/bin/env bash
    set -euo pipefail
    # Audits the running `just serve` (port 8080); start it first in another shell.
    if ! curl -sf -o /dev/null "http://localhost:8080/{{page}}" ; then
        echo "no server on :8080 — run \`just serve\` in another shell first" >&2
        exit 1
    fi
    CHROME_PATH="$(command -v chromium)" npx --yes lighthouse@latest \
        "http://localhost:8080/{{page}}" \
        --quiet --output=html --output=json --output-path=/tmp/lh-report \
        --chrome-flags="--headless=new --no-sandbox --disable-gpu" \
        --only-categories=performance,accessibility,best-practices,seo
    echo "report: /tmp/lh-report.report.html"

[private]
alias a := audit

# audit, then open the HTML report in a browser
audit-open page="index.html": (audit page)
    xdg-open /tmp/lh-report.report.html

# audit, then print a compact, agent-friendly summary from the report JSON
audit-ai page="index.html": (audit page)
    #!/usr/bin/env bash
    set -euo pipefail
    node -e '
      const r = require("/tmp/lh-report.report.json");
      const a = r.audits;
      const sc = (o) => Math.round(o.score * 100);
      console.log("# Lighthouse — " + (r.finalDisplayedUrl || r.finalUrl || r.requestedUrl));
      console.log(Object.values(r.categories).map((c) => c.title + " " + sc(c)).join(" | "));
      const m = ["first-contentful-paint","largest-contentful-paint","total-blocking-time","cumulative-layout-shift","speed-index"];
      console.log("\nMetrics: " + m.filter((k) => a[k]).map((k) => a[k].title + " " + a[k].displayValue).join(" | "));
      const fails = Object.values(a).filter((x) => x.score !== null && x.score < 0.9).sort((x, y) => x.score - y.score);
      console.log("\nIssues (" + fails.length + "):");
      for (const x of fails) {
        const ms = x.details && x.details.overallSavingsMs ? " (~" + Math.round(x.details.overallSavingsMs) + "ms)" : "";
        console.log("- [" + Math.round(x.score * 100) + "] " + x.title + ms);
      }
    '

# start watching source files and runs `build` on change
watch *args:
    #!/usr/bin/env bash
    echo "start watching.."
    exts="el,org,css,scss,js,webp,png,jpg,jpeg,gif,svg"
    ig=(--ignore 'index.org' --ignore '**/tags/**' --ignore '**/ltximg/**' --ignore '**/*.min.css')
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
