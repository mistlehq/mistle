#!/bin/sh
set -eu

repo_root="$1"
worktree_path="$2"
branch_name="$3"
base_ref="$4"
cleanup_worktree_on_error="no"
copied_local_files=""
initialized_local_files=""
missing_local_files=""

quote_for_shell() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

append_csv_value() {
  current_value="$1"
  next_value="$2"

  if [ "$current_value" = "" ]; then
    printf '%s' "$next_value"
    return
  fi

  printf '%s,%s' "$current_value" "$next_value"
}

copy_optional_local_bootstrap_file() {
  relative_path="$1"
  source_path="$repo_root/$relative_path"
  target_path="$worktree_path/$relative_path"

  if [ ! -f "$source_path" ]; then
    missing_local_files="$(append_csv_value "$missing_local_files" "$relative_path")"
    return
  fi

  mkdir -p "$(dirname "$target_path")"
  cp -p "$source_path" "$target_path"
  copied_local_files="$(append_csv_value "$copied_local_files" "$relative_path")"
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

git -C "$repo_root" worktree add -b "$branch_name" "$worktree_path" "$base_ref"
cleanup_worktree_on_error="yes"

copy_optional_local_bootstrap_file ".env.dev"
copy_optional_local_bootstrap_file "integration-targets.provision.json"

(
  cd "$worktree_path"
  direnv exec "$worktree_path" pnpm install
)

if [ -f "$repo_root/config/config.development.toml" ]; then
  copy_optional_local_bootstrap_file "config/config.development.toml"
else
  (
    cd "$worktree_path"
    direnv exec "$worktree_path" pnpm config:init:dev
  )
  initialized_local_files="$(append_csv_value "$initialized_local_files" "config/config.development.toml")"
fi

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
if [ "$copied_local_files" != "" ]; then
  printf 'copied_local_files=%s\n' "$copied_local_files"
fi
if [ "$initialized_local_files" != "" ]; then
  printf 'initialized_local_files=%s\n' "$initialized_local_files"
fi
if [ "$missing_local_files" != "" ]; then
  printf 'missing_local_files=%s\n' "$missing_local_files"
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
