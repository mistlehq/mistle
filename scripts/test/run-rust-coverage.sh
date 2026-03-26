#!/usr/bin/env bash
set -euo pipefail

llvm_version="$(rustc -vV | sed -n 's/^LLVM version: //p')"
if [[ -z "${llvm_version}" ]]; then
  echo "failed to determine rustc LLVM version" >&2
  exit 1
fi

shopt -s nullglob
llvm_cov_candidates=(/nix/store/*llvm-"${llvm_version}"/bin/llvm-cov)
llvm_profdata_candidates=(/nix/store/*llvm-"${llvm_version}"/bin/llvm-profdata)
shopt -u nullglob

if [[ ${#llvm_cov_candidates[@]} -eq 0 ]]; then
  echo "failed to locate llvm-cov for LLVM ${llvm_version} under /nix/store" >&2
  exit 1
fi

if [[ ${#llvm_profdata_candidates[@]} -eq 0 ]]; then
  echo "failed to locate llvm-profdata for LLVM ${llvm_version} under /nix/store" >&2
  exit 1
fi

mkdir -p packages/sandbox-rs-napi/coverage

LLVM_COV="${llvm_cov_candidates[0]}" \
LLVM_PROFDATA="${llvm_profdata_candidates[0]}" \
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
