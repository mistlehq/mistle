import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxBaseImageSourceKinds } from "../../types.js";
import { resolveTensorlakeImportSource } from "./base-image-builder.js";
import { createTensorlakeRegisteredBaseImageName } from "./image-handle.js";

describe("resolveTensorlakeImportSource", () => {
  it("imports image sources under the deterministic Tensorlake registered image name", () => {
    const sourceImageRef = "ghcr.io/mistlehq/sandbox-base:v1.2.3";

    expect(
      resolveTensorlakeImportSource({
        source: {
          kind: SandboxBaseImageSourceKinds.IMAGE,
          imageId: sourceImageRef,
        },
      }),
    ).toEqual({
      registeredName: createTensorlakeRegisteredBaseImageName(sourceImageRef),
      sourceImageRef,
    });
  });

  it("imports SDK image sources using their explicit registered image name", () => {
    expect(
      resolveTensorlakeImportSource({
        source: {
          kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
          baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
          contextPath: ".",
          imageId: "mistle-base",
        },
      }),
    ).toEqual({
      registeredName: "mistle-base",
      sourceImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
    });
  });

  it("fails fast for Dockerfile sources because Tensorlake imports registry images", () => {
    expect(() =>
      resolveTensorlakeImportSource({
        source: {
          kind: SandboxBaseImageSourceKinds.DOCKERFILE,
          contextPath: ".",
          dockerfilePath: "./Dockerfile",
          imageId: "mistle-base",
          publishMode: "push",
        },
      }),
    ).toThrow("Tensorlake base image builder requires an image source or SDK image source.");
  });

  it("fails fast for platform overrides because Tensorlake import resolves the registry ref", () => {
    expect(() =>
      resolveTensorlakeImportSource({
        platform: "linux/amd64",
        source: {
          kind: SandboxBaseImageSourceKinds.IMAGE,
          imageId: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
        },
      }),
    ).toThrow(SandboxConfigurationError);
  });

  it("requires non-empty registry refs and registered names", () => {
    expect(() =>
      resolveTensorlakeImportSource({
        source: {
          kind: SandboxBaseImageSourceKinds.IMAGE,
          imageId: " ",
        },
      }),
    ).toThrow("Tensorlake base image import requires a non-empty source image ref.");

    expect(() =>
      resolveTensorlakeImportSource({
        source: {
          kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
          baseImageRef: "ghcr.io/mistlehq/sandbox-base:v1.2.3",
          contextPath: ".",
          imageId: " ",
        },
      }),
    ).toThrow("Tensorlake base image import requires a non-empty registered image name.");
  });
});
