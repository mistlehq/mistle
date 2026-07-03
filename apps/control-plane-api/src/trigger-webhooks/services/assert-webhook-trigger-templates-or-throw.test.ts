import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationWebhookEventDefinition } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { TriggerWebhooksBadRequestCodes } from "../constants.js";
import { assertWebhookTriggerTemplatesOrThrow } from "./assert-webhook-trigger-templates-or-throw.js";

const SupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] = [
  {
    eventType: "github.issue_comment.created",
    providerEventType: "issue_comment",
    displayName: "Issue comment created",
    payloadReferences: [
      {
        path: ["repository", "full_name"],
        description: "Repository owner and name",
      },
      {
        path: ["issue", "number"],
        description: "Issue number",
      },
      {
        path: ["comment", "body"],
        description: "Comment body",
      },
    ],
  },
];

describe("assertWebhookTriggerTemplatesOrThrow", () => {
  it("maps invalid trigger user message references to a webhook template bad request", () => {
    expect(() =>
      assertWebhookTriggerTemplatesOrThrow({
        eventTypes: ["github.issue_comment.created"],
        inputTemplate: "Review {{payload.pull_request.number}}",
        conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
        idempotencyKeyTemplate: null,
        supportedWebhookEvents: SupportedWebhookEvents,
      }),
    ).toThrow(BadRequestError);

    let caughtError: unknown;
    try {
      assertWebhookTriggerTemplatesOrThrow({
        eventTypes: ["github.issue_comment.created"],
        inputTemplate: "Review {{payload.pull_request.number}}",
        conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
        idempotencyKeyTemplate: null,
        supportedWebhookEvents: SupportedWebhookEvents,
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(BadRequestError);
    expect(caughtError).toMatchObject({
      code: TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_TEMPLATE_REFERENCES,
    });
    expect(String(caughtError)).toContain("inputTemplate");
    expect(String(caughtError)).toContain("payload.pull_request.number");
  });
});
