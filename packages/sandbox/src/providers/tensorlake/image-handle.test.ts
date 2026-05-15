import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider } from "../../types.js";
import {
  createTensorlakeRegisteredBaseImageName,
  createTensorlakeRegisteredImageHandle,
  createTensorlakeSnapshotImageHandle,
  parseTensorlakeImageHandle,
  resolveTensorlakeStartImage,
} from "./image-handle.js";

describe("Tensorlake image handles", () => {
  it("round trips registered image handles", () => {
    const handle = createTensorlakeRegisteredImageHandle("mistle-base");

    expect(handle.provider).toBe(SandboxProvider.TENSORLAKE);
    expect(parseTensorlakeImageHandle(handle)).toEqual({ kind: "image", id: "mistle-base" });
  });

  it("round trips snapshot image handles", () => {
    const handle = createTensorlakeSnapshotImageHandle("snap_123");

    expect(parseTensorlakeImageHandle(handle)).toEqual({ kind: "snapshot", id: "snap_123" });
  });

  it("rejects untyped Tensorlake image ids", () => {
    expect(() =>
      parseTensorlakeImageHandle({
        provider: SandboxProvider.TENSORLAKE,
        imageId: "snap_123",
        createdAt: "2026-05-11T00:00:00.000Z",
      }),
    ).toThrow(SandboxConfigurationError);
  });

  it("resolves GHCR base image refs to deterministic registered image names", () => {
    const imageId = "ghcr.io/mistlehq/sandbox-base:v1.2.3";

    expect(createTensorlakeRegisteredBaseImageName(imageId)).toBe(
      "mistle-2007239adae78582586d0995",
    );
    expect(
      resolveTensorlakeStartImage({
        provider: SandboxProvider.TENSORLAKE,
        imageId,
        createdAt: "2026-05-11T00:00:00.000Z",
      }),
    ).toEqual({
      kind: "image",
      id: "mistle-2007239adae78582586d0995",
      sourceBaseImageRef: imageId,
    });
  });

  it("uses GHCR digest refs directly for deterministic registered image names", () => {
    const imageId =
      "ghcr.io/mistlehq/sandbox-base@sha256:1111111111111111111111112222222222222222222222223333333333333333";

    expect(createTensorlakeRegisteredBaseImageName(imageId)).toBe(
      "mistle-111111111111111111111111",
    );
    expect(
      resolveTensorlakeStartImage({
        provider: SandboxProvider.TENSORLAKE,
        imageId,
        createdAt: "2026-05-11T00:00:00.000Z",
      }),
    ).toEqual({
      kind: "image",
      id: "mistle-111111111111111111111111",
      sourceBaseImageRef: imageId,
    });
  });

  it("preserves explicit Tensorlake registered image ids", () => {
    expect(
      resolveTensorlakeStartImage({
        provider: SandboxProvider.TENSORLAKE,
        imageId: "mistle:production:abcdef",
        createdAt: "2026-05-11T00:00:00.000Z",
      }),
    ).toEqual({
      kind: "image",
      id: "mistle:production:abcdef",
    });
  });
});
