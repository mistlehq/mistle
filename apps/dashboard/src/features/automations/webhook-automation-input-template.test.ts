import { describe, expect, it } from "vitest";

import {
  buildWebhookAutomationInputTemplate,
  parseWebhookAutomationInputTemplate,
} from "./webhook-automation-input-template.js";

describe("webhook automation input template", () => {
  it("builds the canonical template envelope", () => {
    expect(
      buildWebhookAutomationInputTemplate({
        instructions: "Please write a review of the changes made.",
      }),
    ).toBe(
      '{"instructions":"Please write a review of the changes made.","eventType":"{{webhookEvent.eventType}}","payload":{{payload}}}',
    );
  });

  it("round-trips instructions with quotes and newlines", () => {
    const template = buildWebhookAutomationInputTemplate({
      instructions: 'Review "these" changes.\nFocus on risk.',
    });

    expect(parseWebhookAutomationInputTemplate({ template })).toEqual({
      ok: true,
      instructions: 'Review "these" changes.\nFocus on risk.',
    });
  });

  it("accepts equivalent pretty-printed canonical json", () => {
    expect(
      parseWebhookAutomationInputTemplate({
        template: `{
  "payload": {{payload}},
  "instructions": "Review this",
  "eventType": "{{webhookEvent.eventType}}"
}`,
      }),
    ).toEqual({
      ok: true,
      instructions: "Review this",
    });
  });

  it("does not rewrite payload placeholders inside instructions", () => {
    expect(
      parseWebhookAutomationInputTemplate({
        template: `{
  "instructions": "Mention {{payload}} literally",
  "eventType": "{{webhookEvent.eventType}}",
  "payload": {{payload}}
}`,
      }),
    ).toEqual({
      ok: true,
      instructions: "Mention {{payload}} literally",
    });
  });

  it("rejects custom templates", () => {
    expect(
      parseWebhookAutomationInputTemplate({
        template: '{"instructions":"Review it","payload":{{payload}}}',
      }),
    ).toEqual({
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    });
  });

  it("rejects changed event type placeholders", () => {
    expect(
      parseWebhookAutomationInputTemplate({
        template:
          '{"instructions":"Review it","eventType":"{{payload.eventType}}","payload":{{payload}}}',
      }),
    ).toEqual({
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    });
  });
});
