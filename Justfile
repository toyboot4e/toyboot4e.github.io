# Just a task runner
# <https://github.com/casey/just>

set positional-arguments

# shows this help message
help:
    @just -l

# build the devlog (-d --draft, -f --force), then format and postprocess
build *args:
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
# sentinel.
format:
    #!/usr/bin/env bash
    set -euo pipefail
    mapfile -t files < <(grep -rL --include='*.html' -- '<!--pp-->' out 2>/dev/null || true)
    if [ "${#files[@]}" -eq 0 ]; then echo "post: nothing to bake"; exit 0; fi
    echo "post: formatting + baking ${#files[@]} file(s).."
    # Run prettier first
    prettier --print-width 100 --write "${files[@]}" >/dev/null
    bun scripts/postprocess.ts "${files[@]}"

[private]
alias fmt := format

[private]
alias f := format

# minify hand-written CSS in `src/style/` into `*.min.css` (re-run after editing CSS)
min-css:
    #!/usr/bin/env bash
    set -euo pipefail
    for f in style prism-dark prism-light ; do
        npx --yes esbuild "src/style/$f.css" --minify --outfile="src/style/$f.min.css" --log-level=warning
        echo "  $f.css -> $f.min.css ($(wc -c < "src/style/$f.css") -> $(wc -c < "src/style/$f.min.css") bytes)"
    done

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

# start watching source files and runs `build` on chane
watch *args:
    #!/usr/bin/env bash
    echo "start watching.."
    if [[ "${1:-}" == "-d" || "${1:-}" == "--draft" ]] ; then
        echo "draft build"
        # watchexec -e org -w draft --ignore "index.org" "just build --draft && just format"
        watchexec -e el,org,css -w draft --ignore "index.org" "just build --draft"
    elif [[ -z "${1:-}" || "${1:-}" == "-r" || "${1:-}" == "--release" ]] ; then
        echo "release build"
        watchexec -e el,org,css -w src --ignore "index.org" "just build --release && just format"
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
