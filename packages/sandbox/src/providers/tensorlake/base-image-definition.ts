import { Image } from "tensorlake";

import { SandboxdInstallCommand, SandboxdInstallEnvVars } from "../../sandboxd-install.js";
import {
  SandboxSdkImageSandboxdSourceKinds,
  type SandboxSdkImageSandboxdSource,
} from "../../types.js";

export const TensorlakeSandboxBaseImageName = "mistle-sandbox-base";

export function createTensorlakeSandboxBaseImage(input: {
  readonly baseImageRef: string;
  readonly name: string;
  readonly sandboxd?: SandboxSdkImageSandboxdSource;
}): Image {
  const image = new Image({
    name: input.name,
    baseImage: input.baseImageRef,
  }).run(
    [
      "apt-get update",
      "apt-get install -y --no-install-recommends kmod linux-modules-$(uname -r)",
      "rm -rf /var/lib/apt/lists/*",
    ].join(" && "),
  );

  return input.sandboxd === undefined ? image : installSandboxd(image, input.sandboxd);
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
