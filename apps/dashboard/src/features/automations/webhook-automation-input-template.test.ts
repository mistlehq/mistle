import { describe, expect, it } from "vitest";

import {
  DefaultWebhookAutomationInputTemplate,
  InitialWebhookAutomationInputTemplate,
  WebhookAutomationInputTemplatePlaceholder,
} from "./webhook-automation-input-template.js";

describe("webhook automation input template", () => {
  it("exports the default visible template", () => {
    expect(DefaultWebhookAutomationInputTemplate).toBe(
      [
        "Review the webhook event and decide what action to take.",
        "",
        "Event type: {{webhookEvent.eventType}}",
        "Payload: {{payload}}",
      ].join("\n"),
    );
  });

  it("keeps the seeded template distinct from the short placeholder", () => {
    expect(InitialWebhookAutomationInputTemplate).toBe(
      [
        "Replace this with your instructions.",
        "",
        "Put core instructions first so that they can be cached. Add event details after that.",
        "",
        "Event type: {{webhookEvent.eventType}}",
        "Payload: {{payload}}",
      ].join("\n"),
    );
    expect(WebhookAutomationInputTemplatePlaceholder).toBe(
      "Put core instructions first so that they can be cached. Add event details after that.",
    );
  });
});
