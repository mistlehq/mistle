#!/bin/sh
set -eu

repo_root="$1"
worktree_path="$2"
branch_name="$3"
base_ref="$4"
post_worktree_setup_script="$repo_root/scripts/dev/post-worktree-setup.sh"
cleanup_worktree_on_error="no"
post_worktree_setup_report_file=""

quote_for_shell() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

cleanup_failed_worktree() {
  if [ "$cleanup_worktree_on_error" != "yes" ]; then
    return
  fi

  git -C "$repo_root" worktree remove --force "$worktree_path" >/dev/null 2>&1 || true
  git -C "$repo_root" branch -D "$branch_name" >/dev/null 2>&1 || true
}

on_exit() {
  exit_code="$1"

  if [ "$post_worktree_setup_report_file" != "" ]; then
    rm -f "$post_worktree_setup_report_file"
  fi

  if [ "$exit_code" -ne 0 ]; then
    cleanup_failed_worktree
  fi
}

trap 'on_exit "$?"' EXIT

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

command -v direnv >/dev/null 2>&1 || {
  echo "direnv is required to bootstrap the worktree environment" >&2
  exit 1
}

[ -x "$post_worktree_setup_script" ] || {
  echo "post-worktree setup script is missing or not executable: $post_worktree_setup_script" >&2
  exit 1
}

git -C "$repo_root" worktree add -b "$branch_name" "$worktree_path" "$base_ref"
cleanup_worktree_on_error="yes"
post_worktree_setup_report_file="$(mktemp)"
POST_WORKTREE_SETUP_REPORT_FILE="$post_worktree_setup_report_file" \
  "$post_worktree_setup_script" "$repo_root" "$worktree_path"

cleanup_worktree_on_error="no"

resume_command=""
resume_command_cd=""
resume_command_resume=""
copied_to_clipboard="no"

if [ "${CODEX_THREAD_ID:-}" != "" ]; then
  resume_command_cd="cd $(quote_for_shell "$worktree_path")"
  resume_command_resume="codex resume -C . $(quote_for_shell "$CODEX_THREAD_ID")"
  resume_command="$resume_command_cd
$resume_command_resume"
fi

printf 'worktree_path=%s\n' "$worktree_path"
printf 'branch_name=%s\n' "$branch_name"
printf 'base_ref=%s\n' "$base_ref"
if [ -s "$post_worktree_setup_report_file" ]; then
  cat "$post_worktree_setup_report_file"
fi
printf 'bootstrap_steps=copy available local bootstrap files from source worktree,direnv exec <worktree_path> pnpm install,initialize config/config.development.toml when absent in source worktree\n'

if [ "$resume_command" != "" ]; then
  printf 'resume_command_cd=%s\n' "$resume_command_cd"
  printf 'resume_command_resume=%s\n' "$resume_command_resume"

  if command -v pbcopy >/dev/null 2>&1; then
    if printf '%s' "$resume_command" | pbcopy; then
      copied_to_clipboard="yes"
    fi
  fi

  printf 'copied_to_clipboard=%s\n' "$copied_to_clipboard"
else
  printf 'resume_command_cd=\n'
  printf 'resume_command_resume=\n'
  printf 'copied_to_clipboard=no\n'
fi

git -C "$repo_root" worktree list --porcelain
