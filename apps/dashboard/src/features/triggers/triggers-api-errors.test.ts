import { describe, expect, it } from "vitest";

import { createTriggersApiError, TriggersApiError } from "./triggers-api-errors.js";

describe("triggers api errors", () => {
  it("maps trigger list contract errors to trigger-facing messages", () => {
    const error = createTriggersApiError({
      operation: "listTriggers",
      status: 400,
      body: {
        code: "INVALID_LIST_TRIGGERS_INPUT",
        message: "Invalid triggers list request.",
      },
      code: "INVALID_LIST_TRIGGERS_INPUT",
      message: "Invalid triggers list request.",
    });

    expect(error).toBeInstanceOf(TriggersApiError);
    expect(error.message).toBe("The triggers request is invalid.");
  });
});
