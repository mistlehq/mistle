import { describe, expect, it } from "vitest";

import { DefaultWebhookAutomationInputTemplate } from "./webhook-automation-input-template.js";

describe("webhook automation input template", () => {
  it("exports the default visible template", () => {
    expect(DefaultWebhookAutomationInputTemplate).toBe(
      [
        "Review the webhook event and decide what action to take.",
        "",
        "Event type: {{webhookEvent.eventType}}",
        "Payload:",
        "{{payload}}",
      ].join("\n"),
    );
  });
});
