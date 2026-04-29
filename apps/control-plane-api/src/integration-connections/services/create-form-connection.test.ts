import { BadRequestError, ConflictError } from "@mistle/http/errors.js";
import { describe, expect, it } from "vitest";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import {
  shouldAutoCreateManagedWebhookSource,
  shouldReturnPartialManagedWebhookSetupFailure,
} from "./create-form-connection.js";

describe("shouldAutoCreateManagedWebhookSource", () => {
  it("returns true when the method opts into managed webhook source auto-create", () => {
    expect(
      shouldAutoCreateManagedWebhookSource({
        managedWebhookSource: {
          autoCreate: true,
          failureNoticeTitle: "Connection created, webhook setup failed",
          successNoticeTitle: "Connection and webhook created",
        },
      }),
    ).toBe(true);
  });

  it("returns false without an explicit managed webhook source auto-create opt-in", () => {
    expect(shouldAutoCreateManagedWebhookSource(undefined)).toBe(false);
    expect(
      shouldAutoCreateManagedWebhookSource({
        managedWebhookSource: {
          failureNoticeTitle: "Connection created, webhook setup failed",
          successNoticeTitle: "Connection and webhook created",
        },
      }),
    ).toBe(false);
    expect(
      shouldAutoCreateManagedWebhookSource({
        managedWebhookSource: {
          autoCreate: false,
          failureNoticeTitle: "Connection created, webhook setup failed",
          successNoticeTitle: "Connection and webhook created",
        },
      }),
    ).toBe(false);
  });
});

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
