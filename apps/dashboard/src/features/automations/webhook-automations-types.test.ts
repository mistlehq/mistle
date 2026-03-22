import { describe, expect, it } from "vitest";

import {
  DeleteWebhookAutomationResultSchema,
  WebhookAutomationSchema,
  WebhookAutomationsListResultSchema,
} from "./webhook-automations-types.js";

describe("webhook automations types", () => {
  it("parses a webhook automation resource", () => {
    const parsed = WebhookAutomationSchema.parse({
      conversationKeyTemplate: "{{event.id}}",
      createdAt: "2026-03-11T10:00:00.000Z",
      enabled: true,
      eventTypes: ["push"],
      id: "aut_123",
      idempotencyKeyTemplate: null,
      inputTemplate: '{"ref": "{{event.ref}}"}',
      integrationConnectionId: "conn_123",
      kind: "webhook",
      name: "GitHub pushes",
      payloadFilter: {
        action: "push",
      },
      target: {
        id: "target_123",
        sandboxProfileId: "sbp_123",
        sandboxProfileVersion: 4,
      },
      updatedAt: "2026-03-11T10:05:00.000Z",
    });

    expect(parsed.name).toBe("GitHub pushes");
    expect(parsed.target.sandboxProfileVersion).toBe(4);
  });

  it("rejects invalid webhook automation payloads", () => {
    expect(() =>
      WebhookAutomationSchema.parse({
        conversationKeyTemplate: "{{event.id}}",
        createdAt: "2026-03-11T10:00:00.000Z",
        enabled: true,
        eventTypes: null,
        id: "aut_123",
        idempotencyKeyTemplate: null,
        inputTemplate: '{"ref": "{{event.ref}}"}',
        integrationConnectionId: "conn_123",
        kind: "not-webhook",
        name: "GitHub pushes",
        payloadFilter: null,
        target: {
          id: "target_123",
          sandboxProfileId: "sbp_123",
          sandboxProfileVersion: null,
        },
        updatedAt: "2026-03-11T10:05:00.000Z",
      }),
    ).toThrow(/webhook/i);
  });

  it("parses paginated list responses", () => {
    const parsed = WebhookAutomationsListResultSchema.parse({
      items: [
        {
          conversationKeyTemplate: "{{event.id}}",
          createdAt: "2026-03-11T10:00:00.000Z",
          enabled: true,
          eventTypes: null,
          id: "aut_123",
          idempotencyKeyTemplate: null,
          inputTemplate: "{}",
          integrationConnectionId: "conn_123",
          kind: "webhook",
          name: "Automation",
          payloadFilter: null,
          target: {
            id: "target_123",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: null,
          },
          updatedAt: "2026-03-11T10:05:00.000Z",
        },
      ],
      nextPage: {
        after: "cursor_2",
        limit: 20,
      },
      previousPage: null,
      totalResults: 1,
    });

    expect(parsed.nextPage?.after).toBe("cursor_2");
    expect(parsed.totalResults).toBe(1);
  });

  it("parses delete responses", () => {
    const parsed = DeleteWebhookAutomationResultSchema.parse({
      automationId: "aut_123",
    });

    expect(parsed).toEqual({
      automationId: "aut_123",
    });
  });
});
