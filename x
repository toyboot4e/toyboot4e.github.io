#!/usr/bin/env bash -euE

dir="$(dirname "$0")"
cd "$dir"

isForceFlag() {
   [[ "${1:-}" == "-f" || "${1:-}" == "--force" ]]
}

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

