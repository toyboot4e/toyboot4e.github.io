# Just a task runner
# <https://github.com/casey/just>

set positional-arguments

# shows this help message
help:
    @just -l

# build the devlog
build *args:
    emacs -Q --script "./build.el"

[private]
alias b := build

# cleans up the output directory
clean:
    echo "cleaning up the \`out/\` directory.."
    rm -rf out/* > /dev/null 2>&1

[private]
alias c := clean


# formats the output HTML files in-place
format:
    #!/usr/bin/env bash
    echo "formatting all the htmls.."
    cd out
    prettier --print-width 100 --write *.html
    cd diary
    prettier --print-width 100 --write *.html
    cd ../tags
    prettier --print-width 100 --write *.html

[private]
alias fmt := format

[private]
alias f := format

# starts HTTP server
serve:
    cd out && python3 -m http.server 8080

[private]
alias s := serve

# start watching source files and runs `build` on chane
watch *args:
    #!/usr/bin/env bash
    echo "start watching.."
    if [[ "${1:-}" == "-d" || "${1:-}" == "--draft" ]] ; then
        echo "draft build"
        # watchexec -e org -w draft --ignore "index.org" "just build --draft && just format"
        watchexec -e org,css -w draft --ignore "index.org" "just build --draft"
    elif [[ -z "${1:-}" || "${1:-}" == "-r" || "${1:-}" == "--release" ]] ; then
        echo "release build"
        watchexec -e org,css -w src --ignore "index.org" "just build --release && just format"
    else
        echo "invalid option"
    fi

[private]
alias w := watch

