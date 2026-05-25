import { Image } from "tensorlake";

import { SandboxdInstallCommand, SandboxdInstallEnvVars } from "../../sandboxd-install.js";
import {
  SandboxSdkImageSandboxdSourceKinds,
  type SandboxSdkImageSandboxdSource,
} from "../../types.js";

export const TensorlakeSandboxBaseImageName = "mistle-sandbox-base";
const TensorlakeSystemdBaseImageRef = "tensorlake/ubuntu-systemd";
const MistleBinPath = "/opt/mistle/bin";
const SandboxBasePath =
  "/opt/mistle/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin";
const ForceNftIptablesBackendCommands = [
  // tensorlake/ubuntu-systemd currently pins iptables/ip6tables to the legacy
  // backend, but Tensorlake sandboxes expose nftables NAT rather than legacy
  // iptables NAT. Docker daemon startup calls iptables for bridge setup, so
  // force the nft compatibility backend until Tensorlake fixes the base image.
  "update-alternatives --set iptables /usr/sbin/iptables-nft",
  "update-alternatives --set ip6tables /usr/sbin/ip6tables-nft",
] as const;

export function createTensorlakeSandboxBaseImage(input: {
  readonly baseImageRef: string;
  readonly name: string;
  readonly sandboxd?: SandboxSdkImageSandboxdSource;
}): Image {
  const image = installSandboxBaseCommon(
    new Image({
      name: input.name,
      baseImage: TensorlakeSystemdBaseImageRef,
    }),
  );

  return input.sandboxd === undefined ? image : installSandboxd(image, input.sandboxd);
}

function installSandboxBaseCommon(image: Image): Image {
  return image
    .env("DEBIAN_FRONTEND", "noninteractive")
    .env("container", "docker")
    .env("PATH", SandboxBasePath)
    .run(
      [
        "apt-get update",
        "apt-get install -y --no-install-recommends bash ca-certificates coreutils curl dbus findutils file fuse gawk git grep iproute2 iptables jq kmod less libatomic1 lsof nftables procps psmisc ripgrep rsync sed sudo systemd systemd-sysv tar unzip zip",
        ...ForceNftIptablesBackendCommands,
        "rm -rf /var/lib/apt/lists/*",
      ].join(" && "),
    )
    .run(
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
    )
    .run(`mkdir -p ${MistleBinPath}`)
    .copy("packages/sandboxd/scripts/cmddir", "/opt/mistle/bin/cmddir")
    .copy("packages/sandboxd/systemd/sandboxd.service", "/etc/systemd/system/sandboxd.service")
    .run(
      [
        "chmod +x /opt/mistle/bin/cmddir",
        "ln -sf /opt/mistle/bin/cmddir /usr/local/bin/cmddir",
        "mkdir -p /etc/systemd/system/multi-user.target.wants",
        "ln -sf /etc/systemd/system/sandboxd.service /etc/systemd/system/multi-user.target.wants/sandboxd.service",
      ].join(" && "),
    )
    .run(
      [
        "mkdir -p /run/mistle /var/lib/mistle/artifacts",
        "chmod 0700 /run/mistle",
        "rm -rf /var/log/journal",
      ].join(" && "),
    )
    .run(
      [
        'curl -fsSL https://mise.run | MISE_VERSION="v2026.4.28" MISE_INSTALL_PATH="/opt/mistle/bin/mise" sh',
        "chmod +x /opt/mistle/bin/mise",
        "ln -sf /opt/mistle/bin/mise /usr/local/bin/mise",
      ].join(" && "),
    )
    .run(
      [
        "curl -fsSL https://archil.com/install | ARCHIL_SKIP_IAM_CHECK=1 sh",
        "ln -sf /usr/bin/archil /opt/mistle/bin/archil",
      ].join(" && "),
    )
    .workdir("/root");
}

function installSandboxd(image: Image, sandboxd: SandboxSdkImageSandboxdSource): Image {
  if (sandboxd.kind === SandboxSdkImageSandboxdSourceKinds.LOCAL) {
    return image
      .copy("packages/sandboxd/.generated/tensorlake/sandboxd-parts", "/tmp/sandboxd-parts")
      .run(
        [
          "cat /tmp/sandboxd-parts/part-* > /tmp/sandboxd.gz",
          "gzip -dc /tmp/sandboxd.gz > /opt/mistle/bin/sandboxd",
          "rm -rf /tmp/sandboxd.gz /tmp/sandboxd-parts",
        ].join(" && "),
      )
      .run(
        [
          "chmod +x /opt/mistle/bin/sandboxd",
          "ln -sf /opt/mistle/bin/sandboxd /opt/mistle/bin/mistle-ssh-sign",
          "ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd",
          "ln -sf /opt/mistle/bin/mistle-ssh-sign /usr/local/bin/mistle-ssh-sign",
        ].join(" && "),
      );
  }

  return image.run(
    [
      dockerfileSafeShellScript(SandboxdInstallCommand, {
        [SandboxdInstallEnvVars.URL]: sandboxd.artifact.url,
        [SandboxdInstallEnvVars.SHA256]: sandboxd.artifact.sha256,
        [SandboxdInstallEnvVars.VERSION]: sandboxd.artifact.version,
      }),
      "ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd",
      "ln -sf /opt/mistle/bin/mistle-ssh-sign /usr/local/bin/mistle-ssh-sign",
    ].join(" && "),
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function dockerfileSafeShellScript(command: string, env: Record<string, string>): string {
  const lines = command.split("\n").map((line) => shellQuote(line));
  const envAssignments = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`);
  return `printf '%s\\n' ${lines.join(" ")} | ${envAssignments.join(" ")} sh -eu`;
}
