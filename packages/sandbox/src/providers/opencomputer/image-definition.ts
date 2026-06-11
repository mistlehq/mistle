import { Buffer } from "node:buffer";

import { Image } from "@opencomputer/sdk/node";

import {
  OpenComputerImageManifestSchema,
  type OpenComputerImageManifest,
  type ValidatedOpenComputerSandboxConfig,
} from "./schemas.js";

export type OpenComputerBaseImageSourceDescriptor =
  | {
      readonly kind: "image";
      readonly imageId: string;
    }
  | {
      readonly kind: "sdk_image";
      readonly imageId: string;
      readonly baseImageRef: string;
    };

export function createOpenComputerBaseImage(input: {
  readonly sandboxd?: ValidatedOpenComputerSandboxConfig["sandboxd"];
  readonly source?: OpenComputerBaseImageSourceDescriptor;
}): Image {
  let image = Image.base()
    .aptInstall(["dbus", "fd-find", "gawk", "nftables", "ripgrep", "systemd", "systemd-sysv"])
    .runCommands(
      [
        "set -eu",
        "sudo -n install -d -m 0755 /opt/mistle/bin",
        "sudo -n install -d -m 0700 /run/mistle",
        "sudo -n install -d -m 0755 /var/lib/mistle/artifacts",
        "printf '%s\\n' 'export PATH=/opt/mistle/bin:$PATH' | sudo -n tee /etc/profile.d/mistle-path.sh >/dev/null",
        "sudo -n chmod 0644 /etc/profile.d/mistle-path.sh",
      ].join("\n"),
    )
    .workdir("/workspace");

  if (input.source !== undefined) {
    image = image.env(createOpenComputerBaseImageSourceEnv(input.source));
  }

  if (input.sandboxd !== undefined) {
    image = image.runCommands(
      createOpenComputerSandboxdInstallImageCommand(input.sandboxd.artifact),
    );
  }

  return image;
}

export function createOpenComputerImageFromManifest(manifest: OpenComputerImageManifest): Image {
  let image = Image.base();
  const parsedManifest = OpenComputerImageManifestSchema.parse(manifest);

  for (const step of parsedManifest.steps) {
    switch (step.type) {
      case "apt_install":
        image = image.aptInstall(step.args.packages);
        break;
      case "pip_install":
        image = image.pipInstall(step.args.packages);
        break;
      case "run":
        image = image.runCommands(...step.args.commands);
        break;
      case "env":
        image = image.env(step.args.vars);
        break;
      case "workdir":
        image = image.workdir(step.args.path);
        break;
      case "add_file":
        image = image.addFile(
          step.args.path,
          Buffer.from(step.args.content, "base64").toString("utf8"),
        );
        break;
      case "add_dir":
        for (const file of step.args.files) {
          image = image.addFile(
            `${step.args.path.replace(/\/+$/u, "")}/${file.relativePath}`,
            Buffer.from(file.content, "base64").toString("utf8"),
          );
        }
        break;
    }
  }

  return image;
}

export function createOpenComputerImageManifest(image: Image): OpenComputerImageManifest {
  return OpenComputerImageManifestSchema.parse(image.toJSON());
}

function createOpenComputerBaseImageSourceEnv(
  source: OpenComputerBaseImageSourceDescriptor,
): Record<string, string> {
  if (source.kind === "image") {
    return {
      MISTLE_OPENCOMPUTER_SOURCE_KIND: source.kind,
      MISTLE_OPENCOMPUTER_SOURCE_IMAGE_ID: source.imageId,
    };
  }

  return {
    MISTLE_OPENCOMPUTER_SOURCE_KIND: source.kind,
    MISTLE_OPENCOMPUTER_SOURCE_IMAGE_ID: source.imageId,
    MISTLE_OPENCOMPUTER_SOURCE_BASE_IMAGE_REF: source.baseImageRef,
  };
}

function createOpenComputerSandboxdInstallImageCommand(input: {
  version: string;
  url: string;
  sha256: string;
}): string {
  return [
    "set -eu",
    'tmp_dir="$(mktemp -d /tmp/mistle-sandboxd.XXXXXX)"',
    "trap 'rm -rf \"$tmp_dir\"' EXIT INT TERM",
    `curl -fL --retry 3 --retry-delay 1 --connect-timeout 10 --max-time 60 ${shellQuote(input.url)} -o "$tmp_dir/sandboxd.tar.gz"`,
    'actual_sha="$(sha256sum "$tmp_dir/sandboxd.tar.gz" | awk \'{print $1}\')"',
    `test "$actual_sha" = ${shellQuote(input.sha256)}`,
    'tar -xzf "$tmp_dir/sandboxd.tar.gz" -C "$tmp_dir"',
    'sudo -n install -m 0755 "$tmp_dir/bin/sandboxd" /opt/mistle/bin/sandboxd',
    `test "$(/opt/mistle/bin/sandboxd version)" = ${shellQuote(input.version)}`,
    "sudo -n ln -sf sandboxd /opt/mistle/bin/mistle-ssh-sign",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
