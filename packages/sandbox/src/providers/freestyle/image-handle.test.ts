import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider } from "../../types.js";
import { createFreestyleSnapshotImageHandle, parseFreestyleImageHandle } from "./image-handle.js";

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
});
