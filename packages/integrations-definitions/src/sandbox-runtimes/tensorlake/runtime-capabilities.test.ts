import { describe, expect, it } from "vitest";

import { TensorlakeSandboxRuntimeResourceCapabilities } from "./runtime-capabilities.js";

describe("Tensorlake sandbox runtime capabilities", () => {
  it("declares the supported CPU and memory controls", () => {
    expect(TensorlakeSandboxRuntimeResourceCapabilities).toEqual({
      vcpuCount: {
        min: 1,
        max: 8,
        step: 1,
        default: 1,
      },
      memoryMb: {
        min: 1024,
        max: 65536,
        step: 1024,
        default: 1024,
        minPerVcpu: 1024,
        maxPerVcpu: 8192,
      },
      storageMb: {
        min: 10240,
        max: 102400,
        step: 1024,
        default: 10240,
      },
    });
  });
});
