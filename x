#!/usr/bin/env bash -euE

# x: line/page counter + watcher

# ---
# $ ./x w  # watch
# ---

IFS=$'\n\t' # internal field separator; used for word splitting by bash
LC_CTYPE=C  # suppress "illigal byte sequence" error

n_ln_chars=50       # number of characters per line
n_page_lines=34  # number of lines per page

_lines() {
    for line in $(cat - | rg -v '^\+?$' | rg ^[^:]) ; do
        n_chars="$(printf '%s' "$line" | wc -m | tr -d ' ')"
        echo "$n_chars / $n_ln_chars + 1" | bc
    done |
        awk '{sum += $1} END {print sum}'
}

_lines_each() {
    for f in $(fd -e adoc . src) ; do
        {
            _n="$(cat "$f" | _lines)"
            echo "$f: $_n"
        } &
     done
     wait
}

_total_lines() {
    _lines_each "$@" | awk '{sum += $2} END {print sum}'
}

_pages_expr() {
    # $1: tot_n_lines
    echo "$1 / $n_page_lines" | bc
}

_pages() {
    tot_n_lines="$(_total_lines "$@")"
    _pages_expr "$tot_n_lines"
}

_watch_update() {
    adbook build --log
    echo "counting.."
    tot_n_lines="$(_total_lines "$@")"
    n_pages="$(_pages_expr "$tot_n_lines")"
    echo "lines: $tot_n_lines, pages: $n_pages"
}

_impl() {
    local _cmd="${1}"
    shift 1

    case "$_cmd" in
        'l' | 'lines')
            _lines "$@" ;;

        'e' | 'each')
            _lines_each "$@" ;;

        't' | 'tot' | 'total')
            _total_lines "$@" ;;

        'p' | 'pages')
            _pages "$@" ;;

        'w' | 'watch')
            watchexec -e adoc,ron -w src "$0 _watch_update"
            ;;

        '_watch_update')
            # Called from `watchexec`
            _watch_update "$@" ;;

        'debug')
            "$@" ;;

        *)
            echo 'Unknown command' ;;
    esac
}

_impl "$@"
