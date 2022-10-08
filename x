#!/usr/bin/env bash -euE

dir="$(dirname "$0")"
cd "$dir"

if [ -d out ] ; then
    rm -rf out/*
else
    mkdir out
fi

_main() {
    arg="${1:-}"
    mode=draft

    if [ $# -ne 0 ] ; then
        if [[ "$arg" == d || "$arg" == "draft" ]] ; then
            mode=draft
        elif [[ "$arg" == r || "$arg" == "release" ]] ; then
            mode=release
        else
            echo "given wrong argument: \`$arg\`" 1>&2
            return
        fi
    fi

    emacs -Q --script "./build.el" -- "$mode"
}

_main "$@"

