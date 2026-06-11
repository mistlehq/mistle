import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider } from "../../types.js";
import {
  createFreestyleSnapshotBaseImageName,
  createFreestyleSnapshotImageHandle,
  parseFreestyleImageHandle,
  resolveFreestyleStartImage,
} from "./image-handle.js";

describe("Freestyle image handles", () => {
  it("round trips snapshot image handles", () => {
    const handle = createFreestyleSnapshotImageHandle("sh_123");

    expect(handle.provider).toBe(SandboxProvider.FREESTYLE);
    expect(parseFreestyleImageHandle(handle)).toEqual({ snapshotId: "sh_123" });
  });

  it("rejects image handles from other providers", () => {
    expect(() =>
      parseFreestyleImageHandle({
        provider: SandboxProvider.DOCKER,
        imageId: "sha256:abc",
        createdAt: "2026-06-07T00:00:00.000Z",
      }),
    ).toThrow(SandboxConfigurationError);
  });

  it("creates deterministic Freestyle snapshot names from source image refs", () => {
    expect(createFreestyleSnapshotBaseImageName("ubuntu:24.04")).toBe(
      createFreestyleSnapshotBaseImageName("ubuntu:24.04"),
    );
    expect(
      createFreestyleSnapshotBaseImageName(
        "ghcr.io/mistlehq/sandbox-base@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ),
    ).toBe("mistle-0123456789abcdef01234567");
  });

  it("resolves GHCR image refs into Freestyle base image snapshot inputs", () => {
    const baseImageRef =
      "ghcr.io/mistlehq/sandbox-base@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    expect(
      resolveFreestyleStartImage({
        provider: SandboxProvider.FREESTYLE,
        imageId: baseImageRef,
        createdAt: "2026-06-07T00:00:00.000Z",
      }),
    ).toEqual({
      kind: "base_image",
      snapshotName: "mistle-0123456789abcdef01234567",
      sourceBaseImageRef: baseImageRef,
    });
  });
});
