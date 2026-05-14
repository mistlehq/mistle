import { Image } from "tensorlake";

import { SandboxdInstallCommand, SandboxdInstallEnvVars } from "../../sandboxd-install.js";
import {
  SandboxSdkImageSandboxdSourceKinds,
  type SandboxSdkImageSandboxdSource,
} from "../../types.js";

export const TensorlakeSandboxBaseImageName = "mistle-sandbox-base";
export const TensorlakeSandboxBaseImageBase = "tensorlake/ubuntu-minimal";

const TensorlakeSandboxBaseAptPackages = [
  "bash",
  "ca-certificates",
  "coreutils",
  "curl",
  "file",
  "findutils",
  "fuse",
  "gawk",
  "git",
  "grep",
  "gzip",
  "iproute2",
  "iptables",
  "jq",
  "kmod",
  "less",
  "libatomic1",
  // Archil's Debian package depends on the Fuse 2 userspace library.
  "libfuse2",
  "linux-modules-$(uname -r)",
  "lsof",
  "nftables",
  "psmisc",
  "procps",
  "ripgrep",
  "rsync",
  "sed",
  "tar",
  "tini",
  "unzip",
  "zip",
] as const;

export function createTensorlakeSandboxBaseImage(input: {
  readonly name: string;
  readonly sandboxd: SandboxSdkImageSandboxdSource;
}): Image {
  const image = new Image({
    name: input.name,
    baseImage: TensorlakeSandboxBaseImageBase,
  })
    .env("DEBIAN_FRONTEND", "noninteractive")
    .env("PATH", "/opt/mistle/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin")
    .run(
      [
        "apt-get update",
        `apt-get install -y --no-install-recommends ${TensorlakeSandboxBaseAptPackages.join(" ")}`,
        "command -v update-ca-certificates",
        "rm -rf /var/lib/apt/lists/*",
      ].join(" && "),
    )
    .run(
      [
        "modprobe nf_tables",
        "(nft delete table ip mistle_tensorlake_probe 2>/dev/null || true)",
        "nft add table ip mistle_tensorlake_probe",
        "nft add chain ip mistle_tensorlake_probe output '{ type nat hook output priority -100; policy accept; }'",
        "nft delete table ip mistle_tensorlake_probe",
      ].join(" && "),
    )
    .run(
      [
        "printf '%s\\n'",
        "'for p in /opt/mistle/bin; do'",
        "'  case \":$PATH:\" in'",
        "'    *\":$p:\"*) ;;'",
        "'    *) PATH=\"$p:$PATH\" ;;'",
        "'  esac'",
        "'done'",
        "'export PATH'",
        "> /etc/profile.d/mistle-path.sh",
      ].join(" "),
    )
    .run("mkdir -p /opt/mistle/bin")
    .copy("packages/sandboxd/scripts/cmddir", "/opt/mistle/bin/cmddir")
    .run("chmod +x /opt/mistle/bin/cmddir && ln -sf /opt/mistle/bin/cmddir /usr/local/bin/cmddir")
    .run("mkdir -p /run/mistle /var/lib/mistle/artifacts && chmod 0700 /run/mistle")
    .run(
      'curl -fsSL https://mise.run | MISE_VERSION="v2026.4.28" MISE_INSTALL_PATH="/opt/mistle/bin/mise" sh',
    )
    .run("chmod +x /opt/mistle/bin/mise && ln -sf /opt/mistle/bin/mise /usr/local/bin/mise")
    .run("curl -fsSL https://archil.com/install -o /tmp/archil-install.sh")
    .run("ARCHIL_SKIP_IAM_CHECK=1 sh /tmp/archil-install.sh")
    .run(
      "ln -sf /usr/bin/archil /opt/mistle/bin/archil && ln -sf /usr/bin/archil /usr/local/bin/archil",
    )
    .workdir("/root");

  return installSandboxd(image, input.sandboxd).run(
    [
      "ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd",
      "ln -sf /opt/mistle/bin/mistle-ssh-sign /usr/local/bin/mistle-ssh-sign",
    ].join(" && "),
  );
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
        ].join(" && "),
      );
  }

  return image.run(
    [
      `${SandboxdInstallEnvVars.URL}=${shellQuote(sandboxd.artifact.url)}`,
      `${SandboxdInstallEnvVars.SHA256}=${shellQuote(sandboxd.artifact.sha256)}`,
      `${SandboxdInstallEnvVars.VERSION}=${shellQuote(sandboxd.artifact.version)}`,
      "sh",
      "-euc",
      shellQuote(SandboxdInstallCommand),
    ].join(" "),
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
