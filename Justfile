# Just a task runner
# <https://github.com/casey/just>

set positional-arguments

# shows this help message
help:
    @just -l

# build the devlog (TODO: with nix)
build *args:
    #!/usr/bin/env bash
    # TODO: Allowing multiple flags in one word: `./x b -rf` for force release rebuild
    if isForceFlag "${1:-}" || isForceFlag "${2:-}" ; then
        echo "cleaning up the output directory"
        if [ -d out ] ; then
            rm -rf out/*
        else
            mkdir out
        fi
    fi

    # FIXME: Passing `"${1:-}" "${2:-}"` causes error after run
    if [ $# -eq 0 ] ; then
        emacs -Q --script "./build.el"
    elif [ $# -eq 1 ] ; then
        emacs -Q --script "./build.el" -- "$1"
    elif [ $# -eq 2 ] ; then
        emacs -Q --script "./build.el" -- "$1" "$2"
    else
        echo "given too many arguments" 1>&2
    fi

[private]
alias b := build

# cleans up the output directory
clean:
    echo "cleaning up the \`out/\` directory.."
    rm -rf out/* > /dev/null 2>&1

[private]
alias c := clean

# starts HTTP server
serve:
    #!/usr/bin/env bash
    cd out
    python3 -m http.server 8080

[private]
alias s := serve

# formats the output HTML files in-place
format:
    #!/usr/bin/env bash
    echo "formatting all the htmls.."
    cd out
    prettier --print-width 100 --write *.html
    cd diary
    prettier --print-width 100 --write *.html
    cd ../../

[private]
alias fmt := format

[private]
alias f := format

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

