import { dockerfileContent } from "tensorlake";
import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxProvider,
  SandboxSdkImageSandboxdSourceKinds,
} from "../../types.js";
import { TensorlakeBaseImageBuilder } from "./base-image-builder.js";
import { createTensorlakeSandboxBaseImage } from "./base-image-definition.js";
import { parseTensorlakeImageHandle } from "./image-handle.js";

describe("TensorlakeBaseImageBuilder", () => {
  it("treats image sources as existing Tensorlake registered image names", async () => {
    const builder = new TensorlakeBaseImageBuilder({ config: { apiKey: "test-api-key" } });

    const handle = await builder.ensureBaseImage({
      source: {
        kind: SandboxBaseImageSourceKinds.IMAGE,
        imageId: "mistle-base",
      },
    });

    expect(handle.provider).toBe(SandboxProvider.TENSORLAKE);
    expect(parseTensorlakeImageHandle(handle)).toEqual({ kind: "image", id: "mistle-base" });
  });

  it("defines the sandbox base image through the Tensorlake SDK builder", () => {
    const dockerfileText = dockerfileContent(
      createTensorlakeSandboxBaseImage({
        baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
        name: "mistle-base",
        sandboxd: {
          kind: SandboxSdkImageSandboxdSourceKinds.LOCAL,
        },
      }),
    );

    expect(dockerfileText).toContain("FROM ghcr.io/mistlehq/sandbox-base:v1.2.3");
    expect(dockerfileText).toContain("apt-get install -y --no-install-recommends");
    expect(dockerfileText).toContain("linux-modules-$(uname -r)");
    expect(dockerfileText).toContain("modprobe nf_tables");
    expect(dockerfileText).not.toContain("DEBIAN_FRONTEND");
    expect(dockerfileText).not.toContain("WORKDIR /root");
    expect(dockerfileText).not.toContain("test -x /opt/mistle/bin/sandboxd");
    expect(dockerfileText).not.toContain("command -v mise");
    expect(dockerfileText).not.toContain("command -v archil");
    expect(dockerfileText).not.toContain("https://mise.run");
    expect(dockerfileText).not.toContain("https://archil.com/install");
    expect(dockerfileText).toContain(
      "COPY packages/sandboxd/.generated/tensorlake/sandboxd-parts /tmp/sandboxd-parts",
    );
    expect(dockerfileText).toContain("cat /tmp/sandboxd-parts/part-* > /tmp/sandboxd.gz");
    expect(dockerfileText).toContain("gzip -dc /tmp/sandboxd.gz > /opt/mistle/bin/sandboxd");
  });

  it("can define the sandboxd install through a release artifact", () => {
    const dockerfileText = dockerfileContent(
      createTensorlakeSandboxBaseImage({
        baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
        name: "mistle-base",
        sandboxd: {
          kind: SandboxSdkImageSandboxdSourceKinds.RELEASE,
          artifact: {
            url: "https://github.com/mistlehq/mistle/releases/download/v1.2.3/sandboxd-x86_64-unknown-linux-gnu.tar.gz",
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            version: "1.2.3",
          },
        },
      }),
    );

    expect(dockerfileText).toContain("MISTLE_SANDBOXD_ARTIFACT_URL=");
    expect(dockerfileText).toContain("MISTLE_SANDBOXD_ARTIFACT_SHA256=");
    expect(dockerfileText).toContain("MISTLE_SANDBOXD_ARTIFACT_VERSION=");
    expect(dockerfileText).toContain("curl -fL --retry 3");
    expect(dockerfileText).not.toContain("COPY packages/sandboxd/.generated/tensorlake");
  });

  it("fails fast for Dockerfile sources because Tensorlake uses an SDK image source", async () => {
    const builder = new TensorlakeBaseImageBuilder({ config: { apiKey: "test-api-key" } });

    await expect(
      builder.ensureBaseImage({
        source: {
          kind: SandboxBaseImageSourceKinds.DOCKERFILE,
          contextPath: ".",
          dockerfilePath: "./Dockerfile",
          imageId: "mistle-base",
          publishMode: "push",
        },
      }),
    ).rejects.toThrow("Tensorlake base image builder requires an SDK image source.");
  });

  it("fails fast for platform overrides because Tensorlake builds inside its runtime", async () => {
    const builder = new TensorlakeBaseImageBuilder({ config: { apiKey: "test-api-key" } });

    await expect(
      builder.ensureBaseImage({
        platform: "linux/amd64",
        source: {
          kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
          baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
          contextPath: ".",
          imageId: "mistle-base",
          sandboxd: {
            kind: SandboxSdkImageSandboxdSourceKinds.LOCAL,
          },
        },
      }),
    ).rejects.toBeInstanceOf(SandboxConfigurationError);
  });
});
