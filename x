#!/bin/sh

dir="$(dirname "$0")"
emacs -Q --script "$dir/build.el"

