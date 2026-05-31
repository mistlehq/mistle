export const SandboxdInstallEnvVars = {
  URL: "MISTLE_SANDBOXD_ARTIFACT_URL",
  SHA256: "MISTLE_SANDBOXD_ARTIFACT_SHA256",
  VERSION: "MISTLE_SANDBOXD_ARTIFACT_VERSION",
} as const;

export const SandboxdInstallCommand = `
set -eu

install_dir="/opt/mistle/bin"
current_version=""
if test -x "$install_dir/sandboxd"; then
  current_version="$("$install_dir/sandboxd" version 2>/dev/null || true)"
fi

if test "$current_version" = "$MISTLE_SANDBOXD_ARTIFACT_VERSION"; then
  ln -sf sandboxd "$install_dir/mistle-ssh-sign"
  exit 0
fi

tmp_dir="$(mktemp -d /tmp/mistle-sandboxd.XXXXXX)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

archive_path="$tmp_dir/sandboxd.tar.gz"
curl -fL --retry 3 --retry-delay 1 --connect-timeout 10 --max-time 60 "$MISTLE_SANDBOXD_ARTIFACT_URL" -o "$archive_path"

actual_sha="$(sha256sum "$archive_path" | awk '{print $1}')"
if test "$actual_sha" != "$MISTLE_SANDBOXD_ARTIFACT_SHA256"; then
  echo "sandboxd artifact checksum mismatch: expected $MISTLE_SANDBOXD_ARTIFACT_SHA256, got $actual_sha" >&2
  exit 1
fi

tar -xzf "$archive_path" -C "$tmp_dir"
candidate_path="$tmp_dir/bin/sandboxd"
if test ! -f "$candidate_path"; then
  echo "sandboxd artifact did not contain bin/sandboxd" >&2
  exit 1
fi

chmod 0755 "$candidate_path"
candidate_version="$("$candidate_path" version)"
if test "$candidate_version" != "$MISTLE_SANDBOXD_ARTIFACT_VERSION"; then
  echo "sandboxd artifact version mismatch: expected $MISTLE_SANDBOXD_ARTIFACT_VERSION, got $candidate_version" >&2
  exit 1
fi

mkdir -p "$install_dir"
install -m 0755 "$candidate_path" "$install_dir/sandboxd.new"
mv -f "$install_dir/sandboxd.new" "$install_dir/sandboxd"
ln -sf sandboxd "$install_dir/mistle-ssh-sign"

installed_version="$("$install_dir/sandboxd" version)"
if test "$installed_version" != "$MISTLE_SANDBOXD_ARTIFACT_VERSION"; then
  echo "installed sandboxd version mismatch: expected $MISTLE_SANDBOXD_ARTIFACT_VERSION, got $installed_version" >&2
  exit 1
fi
`.trim();

export const SandboxdStopDaemonCommand = `
set -eu

socket_path="/run/mistle/sandboxd/control.sock"
command -v pgrep >/dev/null 2>&1 || {
  echo "pgrep is required to stop sandboxd" >&2
  exit 1
}
command -v pkill >/dev/null 2>&1 || {
  echo "pkill is required to stop sandboxd" >&2
  exit 1
}

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop sandboxd.service || true
  if systemctl is-active --quiet sandboxd.service; then
    echo "failed to stop sandboxd.service" >&2
    exit 1
  fi
fi

if pgrep -f "^/opt/mistle/bin/sandboxd( |$)" >/dev/null 2>&1; then
  pkill -TERM -f "^/opt/mistle/bin/sandboxd( |$)" || true
  attempts=0
  while pgrep -f "^/opt/mistle/bin/sandboxd( |$)" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if test "$attempts" -ge 50; then
      pkill -KILL -f "^/opt/mistle/bin/sandboxd( |$)" || true
      break
    fi
    sleep 0.1
  done
fi

if pgrep -f "^/opt/mistle/bin/sandboxd( |$)" >/dev/null 2>&1; then
  echo "failed to stop sandboxd daemon" >&2
  exit 1
fi

rm -f "$socket_path"
`.trim();

export const SandboxdResetTransparentEgressNftablesCommand = `
set -eu

table_name="mistle_transparent_egress"
stderr_path="$(mktemp /tmp/mistle-sandboxd-nft-delete.XXXXXX)"
cleanup() {
  rm -f "$stderr_path"
}
trap cleanup EXIT INT TERM

command -v nft >/dev/null 2>&1 || {
  echo "nft is required to reset sandboxd transparent egress rules" >&2
  exit 1
}

if nft delete table ip "$table_name" 2>"$stderr_path"; then
  exit 0
fi

if grep -Eq "No such file or directory|No such table|does not exist" "$stderr_path"; then
  exit 0
fi

cat "$stderr_path" >&2
exit 1
`.trim();
