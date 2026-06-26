import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { SandboxSdkImageSandboxdSourceKinds } from "../../types.js";
import {
  FreestyleCmddirScript,
  createFreestyleBaseImageSetupCommands,
} from "./base-image-definition.js";

describe("createFreestyleBaseImageSetupCommands", () => {
  it("creates Freestyle builder VM setup commands with inline Mistle runtime tooling", () => {
    const commands = createFreestyleBaseImageSetupCommands({
      imageId: "mistle-base",
      baseImageRef: "ghcr.io/mistlehq/sandbox-base:latest",
    });
    const script = commands.join("\n\n");

    expect(script).toContain("apt-get install -y --no-install-recommends");
    expect(script).toContain("nftables");
    expect(script).toContain("iproute2");
    expect(script).toContain("https://mise.run");
    expect(script).toContain("update-alternatives --set iptables /usr/sbin/iptables-nft");
    expect(script).toContain("ln -sf /opt/mistle/bin/cmddir /usr/local/bin/cmddir");
    expect(script).not.toContain("FROM ");
    expect(script).not.toContain("COPY ");
  });

  it("writes cmddir from an embedded script instead of reading a local source checkout", () => {
    const cmddirBase64 = Buffer.from(FreestyleCmddirScript, "utf8").toString("base64");
    const commands = createFreestyleBaseImageSetupCommands({
      imageId: "mistle-base",
      baseImageRef: "ghcr.io/mistlehq/sandbox-base:latest",
    });

    expect(commands.join("\n")).toContain(cmddirBase64);
    expect(FreestyleCmddirScript).toContain("cmddir list | cmddir search <pattern>");
    expect(FreestyleCmddirScript).toContain('list_commands | sort -u | rg -- "$2"');
  });

  it("can install a release sandboxd artifact in the Freestyle builder VM", () => {
    const commands = createFreestyleBaseImageSetupCommands({
      imageId: "mistle-base",
      baseImageRef: "ghcr.io/mistlehq/sandbox-base:latest",
      sandboxd: {
        artifact: {
          version: "1.2.3",
          url: "https://github.com/mistlehq/mistle/releases/download/v1.2.3/sandboxd-x86_64-unknown-linux-gnu.tar.gz",
          sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    });
    const script = commands.join("\n\n");

    expect(SandboxSdkImageSandboxdSourceKinds.RELEASE).toBe("release");
    expect(script).toContain("MISTLE_SANDBOXD_ARTIFACT_URL=");
    expect(script).toContain("MISTLE_SANDBOXD_ARTIFACT_SHA256=");
    expect(script).toContain("MISTLE_SANDBOXD_ARTIFACT_VERSION=");
    expect(script).toContain("ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd");
  });
});
