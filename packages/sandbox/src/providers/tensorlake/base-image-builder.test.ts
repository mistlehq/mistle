import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxBaseImageSourceKinds, SandboxProvider } from "../../types.js";
import { TensorlakeBaseImageBuilder } from "./base-image-builder.js";
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

  it("fails fast for Dockerfile sources because Tensorlake imports registry images", async () => {
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

  it("fails fast for platform overrides because Tensorlake imports the source image as published", async () => {
    const builder = new TensorlakeBaseImageBuilder({ config: { apiKey: "test-api-key" } });

    await expect(
      builder.ensureBaseImage({
        platform: "linux/amd64",
        source: {
          kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
          baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
          contextPath: ".",
          imageId: "mistle-base",
        },
      }),
    ).rejects.toBeInstanceOf(SandboxConfigurationError);
  });

  it("fails fast for blank SDK image registered names", async () => {
    const builder = new TensorlakeBaseImageBuilder({ config: { apiKey: "test-api-key" } });

    await expect(
      builder.ensureBaseImage({
        source: {
          kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
          baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
          contextPath: ".",
          imageId: " ",
        },
      }),
    ).rejects.toThrow("Tensorlake base image import requires a non-empty registered image name.");
  });
});
