import { describe, expect, it } from "vitest";

import {
  combineSandboxStorageCleanupErrors,
  throwSandboxTeardownOutcome,
} from "./teardown-outcome.js";

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

    let error: unknown;
    try {
      throwSandboxTeardownOutcome({
        lifecycle: "destroy",
        computeTeardownError,
        storageCleanupError,
      });
      throw new Error("Expected combined teardown outcome to throw.");
    } catch (caughtError) {
      error = caughtError;
    }
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
  });
});

describe("combineSandboxStorageCleanupErrors", () => {
  it("returns undefined when neither cleanup phase fails", () => {
    expect(
      combineSandboxStorageCleanupErrors({
        lifecycle: "stop",
        beforeComputeTeardownError: undefined,
        afterComputeTeardownError: undefined,
      }),
    ).toBeUndefined();
  });

  it("returns the before-teardown cleanup error when only that phase fails", () => {
    const beforeComputeTeardownError = new Error("before cleanup failed");

    expect(
      combineSandboxStorageCleanupErrors({
        lifecycle: "destroy",
        beforeComputeTeardownError,
        afterComputeTeardownError: undefined,
      }),
    ).toBe(beforeComputeTeardownError);
  });

  it("returns the after-teardown cleanup error when only that phase fails", () => {
    const afterComputeTeardownError = new Error("after cleanup failed");

    expect(
      combineSandboxStorageCleanupErrors({
        lifecycle: "stop",
        beforeComputeTeardownError: undefined,
        afterComputeTeardownError,
      }),
    ).toBe(afterComputeTeardownError);
  });

  it("combines before and after cleanup failures when both phases fail", () => {
    const beforeComputeTeardownError = new Error("before cleanup failed");
    const afterComputeTeardownError = new Error("after cleanup failed");

    const combinedError = combineSandboxStorageCleanupErrors({
      lifecycle: "destroy",
      beforeComputeTeardownError,
      afterComputeTeardownError,
    });

    expect(combinedError).toBeInstanceOf(Error);
    if (!(combinedError instanceof Error)) {
      throw new Error("Expected a combined cleanup error.");
    }

    expect(combinedError.message).toBe(
      "Failed to clean up sandbox storage before and after sandbox destroy compute teardown.",
    );
    expect(combinedError.cause).toEqual({
      beforeComputeTeardownError,
      afterComputeTeardownError,
    });
  });
});
