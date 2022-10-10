#!/usr/bin/env bash -euE

IFS=$'\n\t'

dir="$(dirname "$0")"
cd "$dir"

isForceFlag() {
    [[ "${1:-}" == "-f" || "${1:-}" == "--force" ]]
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
    watchexec -e org -w src --ignore "index.org" "./x release && ./x tidy"
}

_main() {
    # serve
    if [ "${1:-}" = "s" ] || [ "${1:-}" = "serve" ] ; then
        _serve "$@"
        return
    fi

    # tidy
    if [ "${1:-}" = "t" ] || [ "${1:-}" = "tidy" ] ; then
        _tidy "$@"
        return
    fi

    # watch
    if [ "${1:-}" = "w" ] || [ "${1:-}" = "watch" ] ; then
        _watch "$@"
        return
    fi

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

_main "$@"

