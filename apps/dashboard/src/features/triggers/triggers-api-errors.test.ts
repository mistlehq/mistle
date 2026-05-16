import { describe, expect, it } from "vitest";

import { createTriggersApiError, TriggersApiError } from "./triggers-api-errors.js";

describe("triggers api errors", () => {
  it("maps automation list contract errors to trigger-facing messages", () => {
    const error = createTriggersApiError({
      operation: "listTriggers",
      status: 400,
      body: {
        code: "INVALID_LIST_AUTOMATIONS_INPUT",
        message: "Invalid automations list request.",
      },
      code: "INVALID_LIST_AUTOMATIONS_INPUT",
      message: "Invalid automations list request.",
    });

    expect(error).toBeInstanceOf(TriggersApiError);
    expect(error.message).toBe("The triggers request is invalid.");
  });
});
