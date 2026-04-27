import { BadRequestError, ConflictError } from "@mistle/http/errors.js";
import { describe, expect, it } from "vitest";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import { shouldReturnPartialManagedWebhookSetupFailure } from "./create-form-connection.js";

describe("shouldReturnPartialManagedWebhookSetupFailure", () => {
  it("returns true for provider webhook registration failures", () => {
    const error = new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_WEBHOOK_SOURCE_INPUT,
      "Jira admin webhook creation failed (403): Forbidden",
    );

    expect(shouldReturnPartialManagedWebhookSetupFailure(error)).toBe(true);
  });

  it("returns false for other bad request errors", () => {
    const error = new BadRequestError(
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
      "Integration connection does not support webhook sources.",
    );

    expect(shouldReturnPartialManagedWebhookSetupFailure(error)).toBe(false);
  });

  it("returns false for non-bad-request errors", () => {
    expect(shouldReturnPartialManagedWebhookSetupFailure(new Error("Database failed."))).toBe(
      false,
    );
    expect(
      shouldReturnPartialManagedWebhookSetupFailure(
        new ConflictError("CONFLICT", "Connection already exists."),
      ),
    ).toBe(false);
  });
});
