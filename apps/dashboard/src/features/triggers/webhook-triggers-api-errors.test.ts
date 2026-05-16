import { describe, expect, it } from "vitest";

import {
  createWebhookTriggersApiError,
  readWebhookTriggersErrorMessage,
  toWebhookTriggersApiError,
  WebhookTriggersApiError,
} from "./webhook-triggers-api-errors.js";

describe("webhook triggers api errors", () => {
  it("maps known contract error codes to dashboard-friendly messages", () => {
    const error = createWebhookTriggersApiError({
      operation: "createWebhookTrigger",
      status: 400,
      body: {
        code: "WEBHOOK_SOURCE_TARGET_NOT_WEBHOOK_CAPABLE",
        message: "Connection target is not webhook capable.",
      },
      code: "WEBHOOK_SOURCE_TARGET_NOT_WEBHOOK_CAPABLE",
      message: "Connection target is not webhook capable.",
    });

    expect(error).toBeInstanceOf(WebhookTriggersApiError);
    expect(error.message).toBe(
      "The selected integration connection does not support webhook triggers.",
    );
  });

  it("falls back to the source message for unknown codes", () => {
    const error = createWebhookTriggersApiError({
      operation: "createWebhookTrigger",
      status: 400,
      body: {
        code: "UNKNOWN_CODE",
        message: "Original backend message.",
      },
      code: "UNKNOWN_CODE",
      message: "Original backend message.",
    });

    expect(error.message).toBe("Original backend message.");
  });

  it("normalizes arbitrary thrown values into WebhookTriggersApiError", () => {
    const error = toWebhookTriggersApiError({
      operation: "getWebhookTrigger",
      error: {
        status: 404,
        code: "NOT_FOUND",
        message: "Trigger missing.",
      },
      fallbackMessage: "Could not load webhook trigger.",
    });

    expect(error).toBeInstanceOf(WebhookTriggersApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("The webhook trigger no longer exists.");
  });

  it("reads mapped messages directly from unknown error values", () => {
    expect(
      readWebhookTriggersErrorMessage({
        code: "INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE",
        message: "Sandbox profile was invalid.",
      }),
    ).toBe("The selected sandbox profile cannot use this webhook trigger.");
  });
});
