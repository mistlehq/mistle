#!/bin/sh

set -eu

repository_raw_base_url="https://raw.githubusercontent.com/mistlehq/mistle"
install_directory_path="${MISTLE_LOCAL_INSTALL_DIR:-${HOME:-}/.mistle/local}"
local_compose_raw_base_url="${repository_raw_base_url}/main/deploy/compose/local"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

download_file() {
  source_url="$1"
  target_path="$2"

  curl -fsSL "$source_url" -o "$target_path"
}

install_file() {
  file_name="$1"

  download_file "${local_compose_raw_base_url}/${file_name}" "${temporary_directory_path}/${file_name}"
  cp "${temporary_directory_path}/${file_name}" "${install_directory_path}/${file_name}"
}

confirm_install() {
  echo "Mistle local installer"
  echo
  echo "This will:"
  echo "- write compose.yaml, .env.example, up.sh, down.sh, and VERSION to ${install_directory_path}"
  echo "- create ${install_directory_path}/.env from .env.example if it does not already exist"
  echo "- preserve an existing ${install_directory_path}/.env"
  echo "- fetch files from ${local_compose_raw_base_url}"
  echo "- start Mistle by running ${install_directory_path}/up.sh"

  if [ ! -r /dev/tty ]; then
    echo "Installer confirmation requires an interactive terminal." >&2
    exit 1
  fi

  printf "Continue? [y/N] " >/dev/tty
  if ! IFS= read -r answer </dev/tty; then
    echo "Installer confirmation could not be read." >&2
    exit 1
  fi

  case "$answer" in
    y | Y | yes | YES)
      ;;
    *)
      echo "Install cancelled."
      exit 1
      ;;
  esac
}

if [ -z "${HOME:-}" ] && [ -z "${MISTLE_LOCAL_INSTALL_DIR:-}" ]; then
  echo "HOME is not set. Set MISTLE_LOCAL_INSTALL_DIR to choose an install directory." >&2
  exit 1
fi

require_command curl
require_command docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required: docker compose version failed." >&2
  exit 1
fi

confirm_install

temporary_directory_path="$(mktemp -d)"
trap 'rm -rf "$temporary_directory_path"' EXIT INT TERM

mkdir -p "$install_directory_path"

install_file compose.yaml
install_file .env.example
install_file up.sh
install_file down.sh
download_file "${repository_raw_base_url}/main/VERSION" "${temporary_directory_path}/VERSION"
cp "${temporary_directory_path}/VERSION" "${install_directory_path}/VERSION"

chmod +x "${install_directory_path}/up.sh" "${install_directory_path}/down.sh"

if [ ! -f "${install_directory_path}/.env" ]; then
  cp "${install_directory_path}/.env.example" "${install_directory_path}/.env"
fi

echo "Installed Mistle local Compose files to ${install_directory_path}"

cd "$install_directory_path"
./up.sh
