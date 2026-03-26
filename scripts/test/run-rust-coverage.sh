#!/usr/bin/env bash
set -euo pipefail

llvm_version="$(rustc -vV | sed -n 's/^LLVM version: //p')"
if [[ -z "${llvm_version}" ]]; then
  echo "failed to determine rustc LLVM version" >&2
  exit 1
fi

llvm_cov_path="$(command -v llvm-cov || true)"
if [[ -z "${llvm_cov_path}" ]]; then
  echo "failed to locate llvm-cov on PATH" >&2
  exit 1
fi

llvm_profdata_path="$(command -v llvm-profdata || true)"
if [[ -z "${llvm_profdata_path}" ]]; then
  echo "failed to locate llvm-profdata on PATH" >&2
  exit 1
fi

assert_matching_llvm_version() {
  local tool_name="$1"
  local tool_path="$2"

  if ! "$tool_path" --version 2>/dev/null | grep -Fq "LLVM version ${llvm_version}"; then
    echo "${tool_name} at ${tool_path} does not match rustc LLVM ${llvm_version}" >&2
    return 1
  fi
}

assert_matching_llvm_version llvm-cov "${llvm_cov_path}"
assert_matching_llvm_version llvm-profdata "${llvm_profdata_path}"

mkdir -p packages/sandbox-rs-napi/coverage

LLVM_COV="${llvm_cov_path}" \
LLVM_PROFDATA="${llvm_profdata_path}" \
  cargo llvm-cov \
    --manifest-path packages/sandbox-rs-napi/Cargo.toml \
    --locked \
    --lcov \
    --output-path packages/sandbox-rs-napi/coverage/lcov.info

python3 - <<'PY'
from pathlib import Path

repo_root = Path.cwd().resolve()
report_path = repo_root / "packages/sandbox-rs-napi/coverage/lcov.info"
report_contents = report_path.read_text()
report_path.write_text(report_contents.replace(f"SF:{repo_root}/", "SF:"))
PY
