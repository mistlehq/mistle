#!/bin/sh
set -eu

repo_root="$1"
worktree_path="$2"
branch_name="$3"
base_ref="$4"
resolved_base_ref="$base_ref"

quote_for_shell() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

trim_trailing_line_breaks() {
  printf "%s" "$1" | perl -0pe 's/[\r\n]+\z//'
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

if [ "$base_ref" = "main" ] || [ "$base_ref" = "origin/main" ]; then
  git -C "$repo_root" fetch origin main
  resolved_base_ref="origin/main"
fi

git -C "$repo_root" rev-parse --verify "$resolved_base_ref" >/dev/null
git -C "$repo_root" show-ref --verify --quiet "refs/heads/$branch_name" && {
  echo "branch already exists: $branch_name" >&2
  exit 1
}

git -C "$repo_root" worktree add -b "$branch_name" "$worktree_path" "$resolved_base_ref"

cd "$worktree_path"
pnpm install
pnpm config:init:dev

resume_command=""
copied_to_clipboard="no"

if [ "${CODEX_THREAD_ID:-}" != "" ]; then
  sanitized_thread_id="$(trim_trailing_line_breaks "$CODEX_THREAD_ID")"
  case "$sanitized_thread_id" in
    *"$(
      printf '\n'
    )"* | *"$(
      printf '\r'
    )"*)
      echo "CODEX_THREAD_ID must be a single line" >&2
      exit 1
      ;;
  esac

  resume_command="cd $(quote_for_shell "$worktree_path") && codex resume $(quote_for_shell "$sanitized_thread_id")"
fi

printf 'worktree_path=%s\n' "$worktree_path"
printf 'branch_name=%s\n' "$branch_name"
printf 'base_ref=%s\n' "$resolved_base_ref"
printf 'bootstrap_steps=pnpm install,pnpm config:init:dev\n'

if [ "$resume_command" != "" ]; then
  printf 'resume_command=%s\n' "$resume_command"

  if command -v pbcopy >/dev/null 2>&1; then
    if printf '%s' "$resume_command" | pbcopy; then
      copied_to_clipboard="yes"
    fi
  fi

  printf 'copied_to_clipboard=%s\n' "$copied_to_clipboard"
else
  printf 'resume_command=\n'
  printf 'copied_to_clipboard=no\n'
fi

git -C "$repo_root" worktree list --porcelain
