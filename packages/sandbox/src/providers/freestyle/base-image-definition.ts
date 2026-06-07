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

export type FreestyleSnapshotSpec = {
  readonly baseImage: {
    readonly dockerfileContent: string;
  };
  readonly workdir: string;
  readonly additionalFiles: Readonly<Record<string, FreestyleSnapshotFile>>;
};

export type FreestyleSnapshotFile = {
  readonly content: string;
  readonly encoding: "base64";
  readonly executable: boolean;
};

export function createFreestyleSnapshotSpec(
  input: FreestyleCreateSnapshotImageRequest,
): FreestyleSnapshotSpec {
  return {
    baseImage: {
      dockerfileContent: createFreestyleSandboxBaseDockerfile(input),
    },
    workdir: "/root",
    additionalFiles: {
      "/opt/mistle/bin/cmddir": {
        content: input.cmddirBase64,
        encoding: "base64",
        executable: true,
      },
    },
  };
}

export function createFreestyleSandboxBaseDockerfile(
  input: FreestyleCreateSnapshotImageRequest,
): string {
  return [
    `FROM ${input.baseImageRef}`,
    "ENV DEBIAN_FRONTEND=noninteractive",
    "ENV container=docker",
    "ENV HOME=/root",
    `ENV PATH=${SandboxBasePath}`,
    runShell(
      [
        "apt-get update",
        `apt-get install -y --no-install-recommends ${CommonAptPackages.join(" ")}`,
        "update-alternatives --set iptables /usr/sbin/iptables-nft",
        "update-alternatives --set ip6tables /usr/sbin/ip6tables-nft",
        "rm -rf /var/lib/apt/lists/*",
      ].join(" && "),
    ),
    runShell(
      [
        "cat > /etc/profile.d/mistle-path.sh <<'EOF'",
        `for p in ${MistleBinPath}; do`,
        '  case ":$PATH:" in',
        '    *":$p:"*) ;;',
        '    *) PATH="$p:$PATH" ;;',
        "  esac",
        "done",
        "export PATH",
        "EOF",
      ].join("\n"),
    ),
    runShell(
      [
        `mkdir -p ${MistleBinPath} /run/mistle /var/lib/mistle/artifacts`,
        "chmod 0700 /run/mistle",
        "ln -sf /opt/mistle/bin/cmddir /usr/local/bin/cmddir",
        "rm -rf /var/log/journal",
      ].join(" && "),
    ),
    runShell(
      [
        'curl -fsSL https://mise.run | MISE_VERSION="v2026.4.28" MISE_INSTALL_PATH="/opt/mistle/bin/mise" sh',
        "chmod +x /opt/mistle/bin/mise",
        "ln -sf /opt/mistle/bin/mise /usr/local/bin/mise",
      ].join(" && "),
    ),
    ...(input.sandboxd === undefined ? [] : [runShell(createSandboxdReleaseInstall(input))]),
    "WORKDIR /root",
  ].join("\n");
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

function runShell(script: string): string {
  return ["RUN <<'FREESTYLE_EOF'", script, "FREESTYLE_EOF"].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function dockerfileSafeShellScript(command: string, env: Record<string, string>): string {
  const lines = command.split("\n").map((line) => shellQuote(line));
  const envAssignments = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`);
  return `printf '%s\\n' ${lines.join(" ")} | ${envAssignments.join(" ")} sh -eu`;
}
