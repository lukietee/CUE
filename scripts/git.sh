#!/bin/sh
# This workspace's sandbox blocks .git writes; local metadata lives in .cue-git.
set -eu
CUE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -e "$CUE_ROOT/.git" ]; then
  exec git -C "$CUE_ROOT" "$@"
fi
exec git --git-dir="$CUE_ROOT/.cue-git" --work-tree="$CUE_ROOT" "$@"
