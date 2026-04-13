#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <install-dir>" >&2
  exit 1
fi

install_dir=$1
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "${script_dir}/../.." && pwd)
compile_runtime_file="${repo_root}/packages/integrations-definitions/src/agent-runtimes/codex/compile-runtime.ts"

codex_version=$(sed -n 's/^const CodexCliVersion = "\(.*\)";$/\1/p' "${compile_runtime_file}")
if [[ -z "${codex_version}" ]]; then
  echo "failed to resolve Codex CLI version from ${compile_runtime_file}" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "install-codex-cli.sh only supports Linux CI hosts" >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64)
    asset_file="codex-x86_64-unknown-linux-musl.tar.gz"
    asset_binary="codex-x86_64-unknown-linux-musl"
    ;;
  arm64|aarch64)
    asset_file="codex-aarch64-unknown-linux-musl.tar.gz"
    asset_binary="codex-aarch64-unknown-linux-musl"
    ;;
  *)
    echo "unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

release_tag="rust-v${codex_version}"
download_url="https://github.com/openai/codex/releases/download/${release_tag}/${asset_file}"
tmp_dir=$(mktemp -d)
archive_path="${tmp_dir}/${asset_file}"

cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

curl --fail --location --silent --show-error --output "${archive_path}" "${download_url}"
tar -xzf "${archive_path}" -C "${tmp_dir}"

mkdir -p "${install_dir}"
install "${tmp_dir}/${asset_binary}" "${install_dir}/codex"

printf '%s\n' "${install_dir}/codex"
