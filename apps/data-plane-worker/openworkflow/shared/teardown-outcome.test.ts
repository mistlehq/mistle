import { describe, expect, it } from "vitest";

import { throwSandboxTeardownOutcome } from "./teardown-outcome.js";

describe("throwSandboxTeardownOutcome", () => {
  it("does nothing when compute teardown and storage cleanup both succeed", () => {
    expect(() =>
      throwSandboxTeardownOutcome({
        lifecycle: "stop",
        computeTeardownError: undefined,
        storageCleanupError: undefined,
      }),
    ).not.toThrow();
  });

  it("rethrows the compute teardown error when storage cleanup succeeds", () => {
    const computeTeardownError = new Error("compute teardown failed");

    expect(() =>
      throwSandboxTeardownOutcome({
        lifecycle: "destroy",
        computeTeardownError,
        storageCleanupError: undefined,
      }),
    ).toThrow(computeTeardownError);
  });

  it("throws the storage cleanup error when compute teardown succeeds", () => {
    const storageCleanupError = new Error("storage cleanup failed");

    expect(() =>
      throwSandboxTeardownOutcome({
        lifecycle: "stop",
        computeTeardownError: undefined,
        storageCleanupError,
      }),
    ).toThrow(storageCleanupError);
  });

  it("preserves both failures when compute teardown and storage cleanup both fail", () => {
    const computeTeardownError = new Error("compute teardown failed");
    const storageCleanupError = new Error("storage cleanup failed");

    try {
      throwSandboxTeardownOutcome({
        lifecycle: "destroy",
        computeTeardownError,
        storageCleanupError,
      });
      throw new Error("Expected combined teardown outcome to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) {
        throw error;
      }

      expect(error.message).toBe(
        "Failed to destroy sandbox compute and failed to clean up sandbox storage after compute teardown.",
      );
      expect(error.cause).toEqual({
        computeTeardownError,
        storageCleanupError,
      });
    }
  });
});
