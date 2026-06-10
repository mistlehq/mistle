import { describe, expect, it } from "vitest";

import { ModalSandboxRuntimeResourceCapabilities } from "./runtime-capabilities.js";

describe("Modal sandbox runtime capabilities", () => {
  it("declares the supported CPU and memory controls", () => {
    expect(ModalSandboxRuntimeResourceCapabilities).toEqual({
      vcpuCount: {
        min: 1,
        max: 8,
        step: 1,
        default: 1,
      },
      memoryMb: {
        min: 1024,
        max: 32_768,
        step: 1024,
        default: 4096,
      },
    });
  });

  it("does not advertise configurable disk", () => {
    expect(ModalSandboxRuntimeResourceCapabilities.diskMb).toBeUndefined();
  });
});
