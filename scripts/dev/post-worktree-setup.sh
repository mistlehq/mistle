#!/bin/sh
set -eu

repo_root="${1:?repo_root is required}"
worktree_path="${2:?worktree_path is required}"
report_file="${POST_WORKTREE_SETUP_REPORT_FILE:-}"
copied_local_files=""
initialized_local_files=""
missing_local_files=""

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

  if [ -e "$target_path" ]; then
    return
  fi

  if [ ! -f "$source_path" ]; then
    missing_local_files="$(append_csv_value "$missing_local_files" "$relative_path")"
    return
  fi

  mkdir -p "$(dirname "$target_path")"
  cp -p "$source_path" "$target_path"
  copied_local_files="$(append_csv_value "$copied_local_files" "$relative_path")"
}

if [ ! -d "$repo_root" ]; then
  echo "repository root does not exist: $repo_root" >&2
  exit 1
fi

if [ ! -d "$worktree_path" ]; then
  echo "worktree path does not exist: $worktree_path" >&2
  exit 1
fi

command -v direnv >/dev/null 2>&1 || {
  echo "direnv is required to bootstrap the worktree environment" >&2
  exit 1
}

direnv allow "$worktree_path"

copy_optional_local_bootstrap_file ".env.dev"
copy_optional_local_bootstrap_file ".env.test"

(
  cd "$worktree_path"
  direnv exec "$worktree_path" pnpm install
)

if [ -f "$worktree_path/config/config.development.toml" ]; then
  :
elif [ -f "$repo_root/config/config.development.toml" ]; then
  copy_optional_local_bootstrap_file "config/config.development.toml"
else
  (
    cd "$worktree_path"
    direnv exec "$worktree_path" pnpm config:init:dev
  )
  initialized_local_files="$(append_csv_value "$initialized_local_files" "config/config.development.toml")"
fi

if [ "$copied_local_files" != "" ]; then
  if [ "$report_file" != "" ]; then
    printf 'copied_local_files=%s\n' "$copied_local_files" >>"$report_file"
  fi
fi
if [ "$initialized_local_files" != "" ]; then
  if [ "$report_file" != "" ]; then
    printf 'initialized_local_files=%s\n' "$initialized_local_files" >>"$report_file"
  fi
fi
if [ "$missing_local_files" != "" ]; then
  if [ "$report_file" != "" ]; then
    printf 'missing_local_files=%s\n' "$missing_local_files" >>"$report_file"
  fi
fi
