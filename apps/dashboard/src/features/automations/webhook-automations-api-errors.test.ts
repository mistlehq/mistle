import { describe, expect, it } from "vitest";

import {
  createWebhookAutomationsApiError,
  readWebhookAutomationsErrorMessage,
  toWebhookAutomationsApiError,
  WebhookAutomationsApiError,
} from "./webhook-automations-api-errors.js";

describe("webhook automations api errors", () => {
  it("maps known contract error codes to dashboard-friendly messages", () => {
    const error = createWebhookAutomationsApiError({
      operation: "createWebhookAutomation",
      status: 400,
      body: {
        code: "CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE",
        message: "Connection target is not webhook capable.",
      },
      code: "CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE",
      message: "Connection target is not webhook capable.",
    });

    expect(error).toBeInstanceOf(WebhookAutomationsApiError);
    expect(error.message).toBe(
      "The selected integration connection does not support webhook automations.",
    );
  });

  it("falls back to the source message for unknown codes", () => {
    const error = createWebhookAutomationsApiError({
      operation: "createWebhookAutomation",
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

  it("normalizes arbitrary thrown values into WebhookAutomationsApiError", () => {
    const error = toWebhookAutomationsApiError({
      operation: "getWebhookAutomation",
      error: {
        status: 404,
        code: "AUTOMATION_NOT_FOUND",
        message: "Automation missing.",
      },
      fallbackMessage: "Could not load webhook automation.",
    });

    expect(error).toBeInstanceOf(WebhookAutomationsApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("The webhook automation no longer exists.");
  });

  it("reads mapped messages directly from unknown error values", () => {
    expect(
      readWebhookAutomationsErrorMessage({
        code: "INVALID_SANDBOX_PROFILE_REFERENCE",
        message: "Sandbox profile was invalid.",
      }),
    ).toBe("The selected sandbox profile is invalid.");
  });
});
