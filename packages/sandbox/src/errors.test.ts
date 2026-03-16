import { describe, expect, it } from "vitest";

import { isSandboxResourceNotFoundError, SandboxResourceNotFoundError } from "./errors.js";

describe("SandboxResourceNotFoundError", () => {
  it("captures the missing sandbox resource identity", () => {
    const error = new SandboxResourceNotFoundError({
      resourceType: "sandbox",
      resourceId: "sbx_123",
    });

    expect(error.message).toBe("sandbox 'sbx_123' was not found.");
    expect(error.resourceType).toBe("sandbox");
    expect(error.resourceId).toBe("sbx_123");
  });

  it("is recognized by the package-level not-found guard", () => {
    const error = new SandboxResourceNotFoundError({
      resourceType: "sandbox",
      resourceId: "sbx_123",
    });

    expect(isSandboxResourceNotFoundError(error)).toBe(true);
    expect(isSandboxResourceNotFoundError(new Error("nope"))).toBe(false);
  });
});
