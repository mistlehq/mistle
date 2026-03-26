#!/usr/bin/env bash
set -euo pipefail

llvm_version="$(rustc -vV | sed -n 's/^LLVM version: //p')"
if [[ -z "${llvm_version}" ]]; then
  echo "failed to determine rustc LLVM version" >&2
  exit 1
fi

shopt -s nullglob
llvm_cov_candidates=(/nix/store/*/bin/llvm-cov)
llvm_profdata_candidates=(/nix/store/*/bin/llvm-profdata)
shopt -u nullglob

resolve_matching_llvm_tool() {
  local tool_name="$1"
  shift
  local candidates=("$@")
  local candidate

  for candidate in "${candidates[@]}"; do
    if "$candidate" --version 2>/dev/null | grep -Fq "LLVM version ${llvm_version}"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "failed to locate ${tool_name} for LLVM ${llvm_version} under /nix/store" >&2
  return 1
}

llvm_cov_path="$(resolve_matching_llvm_tool llvm-cov "${llvm_cov_candidates[@]}")"
llvm_profdata_path="$(resolve_matching_llvm_tool llvm-profdata "${llvm_profdata_candidates[@]}")"

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
