import { Buffer } from "node:buffer";

import { SandboxdInstallCommand, SandboxdInstallEnvVars } from "../../sandboxd-install.js";
import type { FreestyleCreateSnapshotImageRequest } from "./schemas.js";

const MistleBinPath = "/opt/mistle/bin";
const SandboxBasePath =
  "/opt/mistle/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin";

const CommonAptPackages = [
  "bash",
  "ca-certificates",
  "coreutils",
  "curl",
  "dbus",
  "findutils",
  "file",
  "fuse",
  "gawk",
  "git",
  "grep",
  "iproute2",
  "iptables",
  "jq",
  "kmod",
  "less",
  "libatomic1",
  "lsof",
  "nftables",
  "procps",
  "psmisc",
  "ripgrep",
  "rsync",
  "sed",
  "sudo",
  "systemd",
  "systemd-sysv",
  "tar",
  "unzip",
  "zip",
] as const;

export const FreestyleCmddirScript = `#!/bin/sh
set -eu

usage() {
  echo "Usage: cmddir list | cmddir search <pattern>" >&2
  exit 1
}

list_commands() {
  old_ifs=$IFS
  IFS=:
  for dir in $PATH; do
    [ -d "$dir" ] || continue
    for entry in "$dir"/*; do
      [ -f "$entry" ] || continue
      [ -x "$entry" ] || continue
      basename "$entry"
    done
  done
  IFS=$old_ifs
}

[ $# -ge 1 ] || usage

case "$1" in
  list)
    [ $# -eq 1 ] || usage
    list_commands | sort -u
    ;;
  search)
    [ $# -eq 2 ] || usage
    list_commands | sort -u | rg -- "$2"
    ;;
  *)
    usage
    ;;
esac
`;

export function createFreestyleBaseImageSetupCommands(
  input: FreestyleCreateSnapshotImageRequest,
): readonly string[] {
  return [
    createEnvironmentSetupCommand(),
    createPackageInstallCommand(),
    createPathSetupCommand(),
    createCmddirInstallCommand(),
    createMiseInstallCommand(),
    ...(input.sandboxd === undefined ? [] : [createSandboxdReleaseInstall(input)]),
  ];
}

function createEnvironmentSetupCommand(): string {
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "export container=docker",
    "export HOME=/root",
    `export PATH=${shellQuote(SandboxBasePath)}`,
    "printf '%s\\n' 'export DEBIAN_FRONTEND=noninteractive' 'export container=docker' 'export HOME=/root' > /etc/profile.d/mistle-env.sh",
  ].join("\n");
}

function createPackageInstallCommand(): string {
  return [
    "apt-get update",
    `apt-get install -y --no-install-recommends ${CommonAptPackages.join(" ")}`,
    "update-alternatives --set iptables /usr/sbin/iptables-nft",
    "update-alternatives --set ip6tables /usr/sbin/ip6tables-nft",
    "rm -rf /var/lib/apt/lists/*",
  ].join(" && ");
}

function createPathSetupCommand(): string {
  return [
    "cat > /etc/profile.d/mistle-path.sh <<'EOF'",
    `for p in ${MistleBinPath}; do`,
    '  case ":$PATH:" in',
    '    *":$p:"*) ;;',
    '    *) PATH="$p:$PATH" ;;',
    "  esac",
    "done",
    "export PATH",
    "EOF",
    `mkdir -p ${MistleBinPath} /run/mistle /var/lib/mistle/artifacts`,
    "chmod 0700 /run/mistle",
    "rm -rf /var/log/journal",
  ].join("\n");
}

function createCmddirInstallCommand(): string {
  const cmddirBase64 = Buffer.from(FreestyleCmddirScript, "utf8").toString("base64");
  return [
    `mkdir -p ${MistleBinPath}`,
    `base64 -d > ${MistleBinPath}/cmddir <<'EOF'`,
    cmddirBase64,
    "EOF",
    `chmod +x ${MistleBinPath}/cmddir`,
    `ln -sf ${MistleBinPath}/cmddir /usr/local/bin/cmddir`,
  ].join("\n");
}

function createMiseInstallCommand(): string {
  return [
    'curl -fsSL https://mise.run | MISE_VERSION="v2026.4.28" MISE_INSTALL_PATH="/opt/mistle/bin/mise" sh',
    "chmod +x /opt/mistle/bin/mise",
    "ln -sf /opt/mistle/bin/mise /usr/local/bin/mise",
  ].join(" && ");
}

function createSandboxdReleaseInstall(input: FreestyleCreateSnapshotImageRequest): string {
  if (input.sandboxd === undefined) {
    return "";
  }

  return [
    dockerfileSafeShellScript(SandboxdInstallCommand, {
      [SandboxdInstallEnvVars.URL]: input.sandboxd.artifact.url,
      [SandboxdInstallEnvVars.SHA256]: input.sandboxd.artifact.sha256,
      [SandboxdInstallEnvVars.VERSION]: input.sandboxd.artifact.version,
    }),
    "ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd",
    "ln -sf /opt/mistle/bin/mistle-ssh-sign /usr/local/bin/mistle-ssh-sign",
  ].join(" && ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function dockerfileSafeShellScript(command: string, env: Record<string, string>): string {
  const lines = command.split("\n").map((line) => shellQuote(line));
  const envAssignments = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`);
  return `printf '%s\\n' ${lines.join(" ")} | ${envAssignments.join(" ")} sh -eu`;
}
