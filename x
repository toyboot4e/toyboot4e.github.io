#!/usr/bin/env bash -euE

IFS=$'\n\t'

dir="$(dirname "$0")"
cd "$dir"

isForceFlag() {
    [[ "${1:-}" == "-f" || "${1:-}" == "--force" ]]
}

_help() {
    cat <<EOS
Build script for the devlop

USAGE:
    ./x [SUB COMMAND]

SUB COMMANDS:
    build   build the devlog
    serve   starts HTTP server with `python3`
    tidy    formats the output HTML files
    watch   runs `./x build release` on source `.org` file change
EOS
}

_build() {
    # build (TODO: require explicit `b` argument?)
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
}

_serve() {
    cd out
    python3 -m http.server 8080
}

_tidy() {
    echo "tidying all the htmls.."
    for f in $(fd -e html . out) ; do
        tidy -i -m -w 160 -ashtml -utf8 "$f" > /dev/null 2>&1
    done
}

_watch() {
    echo "start watching.."
    watchexec -e org -w src --ignore "index.org" "./x build --release && ./x tidy"
}

_main() {
    if [ $# -eq 0 ] ; then
        _help
        return
    fi

    arg="$1"
    shift

    # build
    if [ "$arg" = "b" ] || [ "$arg" = "build" ] ; then
        _build "$@"
        return
    fi

    # serve
    if [ "$arg" = "s" ] || [ "$arg" = "serve" ] ; then
        _serve "$@"
        return
    fi

    # tidy
    if [ "$arg" = "t" ] || [ "$arg" = "tidy" ] ; then
        _tidy "$@"
        return
    fi

    # watch
    if [ "$arg" = "w" ] || [ "$arg" = "watch" ] ; then
        _watch "$@"
        return
    fi
}

_main "$@"

