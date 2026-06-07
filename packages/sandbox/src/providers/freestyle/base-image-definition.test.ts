import { describe, expect, it } from "vitest";

import { SandboxSdkImageSandboxdSourceKinds } from "../../types.js";
import {
  createFreestyleSandboxBaseDockerfile,
  createFreestyleSnapshotSpec,
} from "./base-image-definition.js";

describe("createFreestyleSnapshotSpec", () => {
  it("creates a Freestyle snapshot spec with Mistle runtime tooling", () => {
    const spec = createFreestyleSnapshotSpec({
      imageId: "mistle-base",
      baseImageRef: "debian:trixie-slim",
      cmddirBase64: "Y21kZGly",
    });

    expect(spec.workdir).toBe("/root");
    expect(spec.additionalFiles["/opt/mistle/bin/cmddir"]).toEqual({
      content: "Y21kZGly",
      encoding: "base64",
      executable: true,
    });
    expect(spec.baseImage.dockerfileContent).toContain("FROM debian:trixie-slim");
    expect(spec.baseImage.dockerfileContent).toContain(
      "apt-get install -y --no-install-recommends",
    );
    expect(spec.baseImage.dockerfileContent).toContain("nftables");
    expect(spec.baseImage.dockerfileContent).toContain("iproute2");
    expect(spec.baseImage.dockerfileContent).toContain("https://mise.run");
    expect(spec.baseImage.dockerfileContent).not.toContain("COPY ");
  });

  it("can bake a release sandboxd artifact into the Freestyle snapshot Dockerfile", () => {
    const dockerfile = createFreestyleSandboxBaseDockerfile({
      imageId: "mistle-base",
      baseImageRef: "debian:trixie-slim",
      cmddirBase64: "Y21kZGly",
      sandboxd: {
        artifact: {
          version: "1.2.3",
          url: "https://github.com/mistlehq/mistle/releases/download/v1.2.3/sandboxd-x86_64-unknown-linux-gnu.tar.gz",
          sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    });

    expect(SandboxSdkImageSandboxdSourceKinds.RELEASE).toBe("release");
    expect(dockerfile).toContain("MISTLE_SANDBOXD_ARTIFACT_URL=");
    expect(dockerfile).toContain("MISTLE_SANDBOXD_ARTIFACT_SHA256=");
    expect(dockerfile).toContain("MISTLE_SANDBOXD_ARTIFACT_VERSION=");
    expect(dockerfile).toContain("ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd");
  });
});
