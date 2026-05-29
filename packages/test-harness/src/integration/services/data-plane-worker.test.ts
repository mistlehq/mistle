import { describe, expect, it } from "vitest";

import { requiresPublicSandboxReachableEndpoints } from "./data-plane-worker.js";

describe("requiresPublicSandboxReachableEndpoints", () => {
  it("uses public gateway endpoints for remote sandbox providers", () => {
    expect(
      requiresPublicSandboxReachableEndpoints({
        provider: "e2b",
      }),
    ).toBe(true);
    expect(
      requiresPublicSandboxReachableEndpoints({
        provider: "tensorlake",
      }),
    ).toBe(true);
  });

  it("keeps Docker on harness-local gateway endpoints", () => {
    expect(
      requiresPublicSandboxReachableEndpoints({
        provider: "docker",
      }),
    ).toBe(false);
  });
});
