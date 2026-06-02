#!/usr/bin/env bash
# Resolves the main worktree root and runs the given hook script from there,
# ensuring all worktrees use the same (latest) version of hook scripts.
#
# For .ts files: runs via `bun run --cwd <main-root> <main-root>/<script>`
# For other files: execs directly as `<main-root>/<script>`
#
# CLAUDE_PROJECT_DIR is intentionally left unchanged so scripts still know
# which worktree triggered them.
#
# Usage (from .claude/settings.json):
#   "$CLAUDE_PROJECT_DIR/.claude/hooks/run-from-main-worktree.sh" scripts/claude-hooks/foo.ts

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# git rev-parse --git-common-dir returns:
#   ".git"                        in the main worktree (relative)
#   "/absolute/path/to/main/.git" in a secondary worktree
GIT_COMMON_DIR=$(cd "$PROJECT_DIR" && git rev-parse --git-common-dir 2>/dev/null) || true

if [ -n "$GIT_COMMON_DIR" ]; then
  ABSOLUTE_GIT_DIR=$(cd "$PROJECT_DIR" && realpath "$GIT_COMMON_DIR")
  MAIN_ROOT=$(dirname "$ABSOLUTE_GIT_DIR")
else
  MAIN_ROOT="$PROJECT_DIR"
fi

SCRIPT="$1"
shift

export CLAUDE_PROJECT_DIR="$PROJECT_DIR"

case "$SCRIPT" in
  *.ts)
    exec bun run --cwd "$MAIN_ROOT" "$MAIN_ROOT/$SCRIPT" "$@"
    ;;
  *)
    exec "$MAIN_ROOT/$SCRIPT" "$@"
    ;;
esac
