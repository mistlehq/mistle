import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider } from "../../types.js";
import {
  createTensorlakeRegisteredImageHandle,
  createTensorlakeSnapshotImageHandle,
  parseTensorlakeImageHandle,
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
});
