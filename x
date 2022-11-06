#!/usr/bin/env bash -euE

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
    serve   starts HTTP server with `python3`
    set     sets draft / release state with file name extension
    tidy    formats the output HTML files
    watch   runs `./x build release` on source `.org` file change
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

_serve() {
    cd out
    python3 -m http.server 8080
}

_set() {
    local flag="${1:-}"

    if ! { [[ "$flag" == "-d" || "$flag" == "-r" ]] ; } ; then
        echo "give \`-d\` or \`-r\` argument" 1>&2
        return
    fi

    shift 1

    for f in "$@" ; do
        echo "$(pwd)"
        if ! [ -f "$f" ] ; then
            echo "- not a file name: \`$f\`" 1>&2
            continue
        fi

        local ext="$(printf '%s' "$f" | rev | cut -d'.' -f 1 | rev)"

        # draft file
        if [ "$ext" == "draft" ] ; then
            if "$flag" == "-r" ]] ; then
                # remove the `.draft` extension:
                local g="${f%.draft}"
                echo "- renaming: \`$f\` => \`$g\`"
                mv "$f" "$g"
            else
                echo "- already a craft: \`$f\`"
            fi 

            continue
        fi

        # releasing file
        if [ "$flag" == "-d" ] ; then
            # add the `.draft` extension:
            local g="$f.draft"
            echo "- renaming: \`$f\` => \`$g\`"
            mv "$f" "$g"
        else
            echo "- already a release: \`$f\`"
        fi 
    done
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

    cmd="$1"
    shift

    if [ "$cmd" == 's' || "$cmd" == 'set' ] ; then
        _set "$@"
        return
    fi

    cd "$dir"
    case "$cmd" in
        'b' | 'build')
            _build "$@" ;;

        'serve')
            _serve "$@" ;;

        't' | 'tidy')
            _tidy "$@" ;;

        'w' | 'watch')
            _watch "$@" ;;

        *)
            echo "not a sub command: \`$cmd\`" ;;
    esac
}

_main "$@"

