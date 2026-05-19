#!/bin/sh

set -eu

repository="mistlehq/mistle"
install_directory_path="${MISTLE_INSTALL_DIR:-/usr/local/bin}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

resolve_target() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "${os}:${arch}" in
    Linux:x86_64 | Linux:amd64)
      printf '%s\n' "x86_64-unknown-linux-gnu"
      ;;
    Linux:aarch64 | Linux:arm64)
      printf '%s\n' "aarch64-unknown-linux-gnu"
      ;;
    Darwin:x86_64 | Darwin:amd64)
      printf '%s\n' "x86_64-apple-darwin"
      ;;
    Darwin:aarch64 | Darwin:arm64)
      printf '%s\n' "aarch64-apple-darwin"
      ;;
    *)
      echo "Unsupported platform: ${os} ${arch}" >&2
      exit 1
      ;;
  esac
}

resolve_release_url_base() {
  if [ -n "${MISTLE_VERSION:-}" ]; then
    case "${MISTLE_VERSION}" in
      v*)
        release_tag="${MISTLE_VERSION}"
        ;;
      *)
        release_tag="v${MISTLE_VERSION}"
        ;;
    esac

    printf 'https://github.com/%s/releases/download/%s\n' "${repository}" "${release_tag}"
    return
  fi

  printf 'https://github.com/%s/releases/latest/download\n' "${repository}"
}

verify_checksum() {
  checksum_file_path="$1"
  asset_file_path="$2"

  expected_checksum="$(awk '{ print $1 }' "${checksum_file_path}")"

  if command -v sha256sum >/dev/null 2>&1; then
    actual_checksum="$(sha256sum "${asset_file_path}" | awk '{ print $1 }')"
  elif command -v shasum >/dev/null 2>&1; then
    actual_checksum="$(shasum -a 256 "${asset_file_path}" | awk '{ print $1 }')"
  else
    echo "Required command not found: sha256sum or shasum" >&2
    exit 1
  fi

  if [ "${actual_checksum}" != "${expected_checksum}" ]; then
    echo "Checksum verification failed for ${asset_file_path}" >&2
    exit 1
  fi
}

require_command curl
require_command tar
require_command uname
require_command awk

target="$(resolve_target)"
asset_name="mistle-cli-${target}.tar.gz"
release_url_base="$(resolve_release_url_base)"

temporary_directory_path="$(mktemp -d)"
trap 'rm -rf "${temporary_directory_path}"' EXIT INT TERM

asset_file_path="${temporary_directory_path}/${asset_name}"
checksum_file_path="${temporary_directory_path}/${asset_name}.sha256"
artifact_directory_path="${temporary_directory_path}/artifact"

curl -fsSL "${release_url_base}/${asset_name}" -o "${asset_file_path}"
curl -fsSL "${release_url_base}/${asset_name}.sha256" -o "${checksum_file_path}"
verify_checksum "${checksum_file_path}" "${asset_file_path}"

mkdir -p "${artifact_directory_path}" "${install_directory_path}"
tar -xzf "${asset_file_path}" -C "${artifact_directory_path}"
cp "${artifact_directory_path}/bin/mistle" "${install_directory_path}/mistle"
chmod 0755 "${install_directory_path}/mistle"

echo "Installed Mistle CLI to ${install_directory_path}/mistle"

case ":${PATH:-}:" in
  *":${install_directory_path}:"*)
    ;;
  *)
    echo "Add ${install_directory_path} to PATH to run mistle from any shell."
    ;;
esac
