import { describe, expect, it } from "vitest";

import { renderTemplateString } from "../../../../control-plane-worker/openworkflow/shared/render-template-string.js";
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

  it("renders plain-text instructions as valid json", () => {
    const renderedTemplate = renderTemplateString({
      template: buildWebhookAutomationInputTemplate({
        instructions: 'Review the comment body for quotes like "this".',
      }),
      context: {
        webhookEvent: {
          eventType: "github.issue_comment.created",
        },
        payload: {
          comment: {
            body: 'A "quoted"\ncomment body',
          },
        },
      },
    });

    expect(JSON.parse(renderedTemplate)).toEqual({
      instructions: 'Review the comment body for quotes like "this".',
      eventType: "github.issue_comment.created",
      payload: {
        comment: {
          body: 'A "quoted"\ncomment body',
        },
      },
    });
  });

  it("rejects custom templates", () => {
    expect(
      parseWebhookAutomationInputTemplate({
        template: "Handle {{payload.comment.body}}",
      }),
    ).toEqual({
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    });
  });
});
