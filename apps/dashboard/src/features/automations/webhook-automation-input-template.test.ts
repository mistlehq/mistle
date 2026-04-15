import { describe, expect, it } from "vitest";

import { DefaultWebhookAutomationMessageTemplate } from "./webhook-automation-input-template.js";

describe("webhook automation input template", () => {
  it("exports the default visible template", () => {
    expect(DefaultWebhookAutomationMessageTemplate).toBe(
      ["Event type: {{webhookEvent.eventType}}", "Payload: {{payload}}"].join("\n"),
    );
  });

  it("exports the compact default message template", () => {
    expect(DefaultWebhookAutomationMessageTemplate).toContain("Event type:");
    expect(DefaultWebhookAutomationMessageTemplate).toContain("Payload:");
  });
});
