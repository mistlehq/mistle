import { describe, expect, it } from "vitest";

import { isIgnorableContainerStopError, stopContainerIgnoringMissing } from "./cleanup.js";

describe("isIgnorableContainerStopError", () => {
  it("accepts docker no such container errors", () => {
    expect(
      isIgnorableContainerStopError({
        statusCode: 404,
        json: {
          message: "No such container: abc123",
        },
      }),
    ).toBe(true);
  });

  it("accepts docker container not running conflicts", () => {
    expect(
      isIgnorableContainerStopError({
        statusCode: 409,
        reason: "container stopped/paused",
        json: {
          message: "container abc123 is not running",
        },
      }),
    ).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(
      isIgnorableContainerStopError({
        statusCode: 500,
        json: {
          message: "unexpected failure",
        },
      }),
    ).toBe(false);
  });
});

describe("stopContainerIgnoringMissing", () => {
  it("suppresses ignorable stop errors", async () => {
    let calls = 0;

    await expect(
      stopContainerIgnoringMissing({
        stop: async () => {
          calls += 1;
          throw {
            statusCode: 409,
            reason: "container stopped/paused",
            json: {
              message: "container abc123 is not running",
            },
          };
        },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toBe(1);
  });

  it("rethrows non-ignorable stop errors", async () => {
    await expect(
      stopContainerIgnoringMissing({
        stop: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
  });
});
