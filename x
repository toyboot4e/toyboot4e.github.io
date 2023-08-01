#!/usr/bin/env -S bash -euE

set -o pipefail

IFS=$'\n\t'
dir="$(dirname "$0")"

isForceFlag() {
    [[ "${1:-}" == "-f" || "${1:-}" == "--force" ]]
}

_help() {
    cat <<EOS
Build script for the devlog

USAGE:
    ./x [SUB COMMAND]

SUB COMMANDS:
    build   build the devlog
    clean   cleans the output directory
    serve   starts HTTP server with \`python3\`
    format  formats the output HTML files
    watch   runs \`./x build release\` on source \`.org\` file change
EOS
}

_build() {
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
}

_clean() {
    echo "cleaning up the \`out/\` directory.."
    rm -rf out/* > /dev/null 2>&1
}

_serve() {
    cd out
    python3 -m http.server 8080
}

_format() {
    echo "formatting all the htmls.."
    npx prettier --write out/*.html
}

_watch() {
    echo "start watching.."
    if [[ "${1:-}" == "-d" || "${1:-}" == "--draft" ]] ; then
        echo "draft build"
        watchexec -e org -w draft --ignore "index.org" "./x build --draft && ./x format"
    elif [[ -z "${1:-}" || "${1:-}" == "-r" || "${1:-}" == "--release" ]] ; then
        echo "release build"
        watchexec -e org -w src --ignore "index.org" "./x build --release && ./x format"
    else
        echo "invalid option"
    fi
}

_main() {
    if [ $# -eq 0 ] ; then
        _help
        return
    fi

    cmd="$1"
    shift

    cd "$dir"

    case "$cmd" in
        'b' | 'build')
            _build "$@"
            _format ;;

        'c' | 'clean')
	    _clean ;;

        'serve')
            _serve "$@" ;;

        'f' | 'format')
            _format "$@" ;;

        'w' | 'watch')
	    _clean
            _watch "$@" ;;

        *)
            echo "not a sub command: \`$cmd\`" ;;
    esac
}

_main "$@"

