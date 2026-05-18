import { describe, expect, it } from "vitest";

import {
  DeleteWebhookTriggerResultSchema,
  WebhookTriggerSchema,
} from "./webhook-triggers-types.js";

describe("webhook triggers types", () => {
  it("parses a webhook trigger resource", () => {
    const parsed = WebhookTriggerSchema.parse({
      conversationKeyTemplate: "{{event.id}}",
      createdAt: "2026-03-11T10:00:00.000Z",
      enabled: true,
      eventTypes: ["push"],
      id: "trg_123",
      idempotencyKeyTemplate: null,
      inputTemplate: '{"ref": "{{event.ref}}"}',
      instructions: "Use terse summaries.",
      integrationWebhookSourceId: "iws_123",
      kind: "webhook",
      name: "GitHub pushes",
      payloadFilter: {
        push: {
          op: "eq",
          path: ["action"],
          value: "push",
        },
      },
      target: {
        id: "tgt_123",
        sandboxProfileId: "sbp_123",
        sandboxProfileVersion: 4,
        primaryRepositoryId: "mistlehq/platform",
      },
      updatedAt: "2026-03-11T10:05:00.000Z",
    });

    expect(parsed.name).toBe("GitHub pushes");
    expect(parsed.target.sandboxProfileVersion).toBe(4);
    expect(parsed.target.primaryRepositoryId).toBe("mistlehq/platform");
  });

  it("rejects invalid webhook trigger payloads", () => {
    expect(() =>
      WebhookTriggerSchema.parse({
        conversationKeyTemplate: "{{event.id}}",
        createdAt: "2026-03-11T10:00:00.000Z",
        enabled: true,
        eventTypes: null,
        id: "trg_123",
        idempotencyKeyTemplate: null,
        inputTemplate: '{"ref": "{{event.ref}}"}',
        instructions: null,
        integrationWebhookSourceId: "iws_123",
        kind: "not-webhook",
        name: "GitHub pushes",
        payloadFilter: null,
        target: {
          id: "target_123",
          sandboxProfileId: "sbp_123",
          sandboxProfileVersion: 1,
          primaryRepositoryId: null,
        },
        updatedAt: "2026-03-11T10:05:00.000Z",
      }),
    ).toThrow(/webhook/i);
  });

  it("parses delete responses", () => {
    const parsed = DeleteWebhookTriggerResultSchema.parse({
      triggerId: "trg_123",
    });

    expect(parsed).toEqual({
      triggerId: "trg_123",
    });
  });
});
