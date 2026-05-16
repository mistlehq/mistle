import { describe, expect, it } from "vitest";

import { DefaultWebhookTriggerMessageTemplate } from "./webhook-trigger-input-template.js";

describe("webhook trigger input template", () => {
  it("exports the default visible template", () => {
    expect(DefaultWebhookTriggerMessageTemplate).toBe(
      ["Event type: {{webhookEvent.eventType}}", "Payload: {{payload}}"].join("\n"),
    );
  });

  it("exports the compact default message template", () => {
    expect(DefaultWebhookTriggerMessageTemplate).toContain("Event type:");
    expect(DefaultWebhookTriggerMessageTemplate).toContain("Payload:");
  });
});
