import { describe, expect, it } from "vitest";

import { buildDefaultWebhookAutomationInputTemplate } from "./webhook-automation-input-template.js";

describe("webhook automation input template", () => {
  it("builds the default visible template", () => {
    expect(buildDefaultWebhookAutomationInputTemplate()).toBe(
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
