import { describe, expect, it } from "vitest";

import { E2BSandboxRuntimeResourceCapabilities } from "./runtime-capabilities.js";

describe("E2B sandbox runtime capabilities", () => {
  it("advertises compute limits in profile-version resource units", () => {
    expect(E2BSandboxRuntimeResourceCapabilities).toEqual({
      vcpuCount: {
        min: 1,
        max: 8,
        step: 1,
        default: 2,
      },
      memoryMb: {
        min: 1024,
        max: 16_384,
        step: 1024,
        default: 4096,
      },
    });
  });

  it("does not advertise configurable disk yet", () => {
    expect(E2BSandboxRuntimeResourceCapabilities.diskMb).toBeUndefined();
  });
});
