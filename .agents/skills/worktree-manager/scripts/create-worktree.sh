#!/bin/sh
set -eu

repo_root="$1"
worktree_path="$2"
branch_name="$3"
base_ref="$4"

quote_for_shell() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

if [ ! -d "$repo_root" ]; then
  echo "repository root does not exist: $repo_root" >&2
  exit 1
fi

if [ -e "$worktree_path" ]; then
  echo "worktree path already exists: $worktree_path" >&2
  exit 1
fi

git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null
git -C "$repo_root" rev-parse --verify "$base_ref" >/dev/null
git -C "$repo_root" show-ref --verify --quiet "refs/heads/$branch_name" && {
  echo "branch already exists: $branch_name" >&2
  exit 1
}

git -C "$repo_root" worktree add -b "$branch_name" "$worktree_path" "$base_ref"

cd "$worktree_path"
pnpm install
pnpm config:init:dev

resume_command=""
launched_terminal="no"
copied_to_clipboard="no"

if [ "${CODEX_THREAD_ID:-}" != "" ]; then
  resume_command="cd $(quote_for_shell "$worktree_path") && codex resume $(quote_for_shell "$CODEX_THREAD_ID")"
fi

printf 'worktree_path=%s\n' "$worktree_path"
printf 'branch_name=%s\n' "$branch_name"
printf 'base_ref=%s\n' "$base_ref"
printf 'bootstrap_steps=pnpm install,pnpm config:init:dev\n'

if [ "$resume_command" != "" ]; then
  printf 'resume_command=%s\n' "$resume_command"

  if command -v pbcopy >/dev/null 2>&1; then
    if printf '%s' "$resume_command" | pbcopy; then
      copied_to_clipboard="yes"
    fi
  fi

  printf 'copied_to_clipboard=%s\n' "$copied_to_clipboard"

  if [ "$(uname -s)" = "Darwin" ] && command -v osascript >/dev/null 2>&1; then
    if osascript - "$resume_command" >/dev/null 2>&1 <<'APPLESCRIPT'
on run argv
  tell application "Terminal"
    activate
    do script (item 1 of argv)
  end tell
end run
APPLESCRIPT
    then
      launched_terminal="yes"
    fi
  fi

  printf 'launched_terminal=%s\n' "$launched_terminal"
else
  printf 'resume_command=\n'
  printf 'copied_to_clipboard=no\n'
  printf 'launched_terminal=no\n'
fi

git -C "$repo_root" worktree list --porcelain
