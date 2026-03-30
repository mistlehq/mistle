import { describe, expect, it } from "vitest";

import {
  createWebhookAutomationListEvent,
  createWebhookAutomationListItem,
} from "./webhook-automation-test-fixtures.js";
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
          sandboxProfileVersion: 1,
        },
        updatedAt: "2026-03-11T10:05:00.000Z",
      }),
    ).toThrow(/webhook/i);
  });

  it("parses paginated list responses", () => {
    const parsed = WebhookAutomationsListResultSchema.parse({
      items: [
        createWebhookAutomationListItem({
          name: "Automation",
          targetName: "Production",
          events: [
            createWebhookAutomationListEvent({
              label: "CI Completed",
              logoKey: "github",
            }),
          ],
          updatedAt: "2026-03-11T10:05:00.000Z",
        }),
      ],
      nextPage: {
        after: "cursor_2",
        limit: 20,
      },
      previousPage: null,
      totalResults: 1,
    });

    expect(parsed.nextPage?.after).toBe("cursor_2");
    expect(parsed.items[0]?.events[0]?.label).toBe("CI Completed");
    expect(parsed.totalResults).toBe(1);
  });

  it("parses list items with row-level issues", () => {
    const parsed = WebhookAutomationsListResultSchema.parse({
      items: [
        {
          enabled: true,
          events: [
            {
              label: "issue_comment.created",
              unavailable: true,
            },
          ],
          id: "aut_123",
          issue: {
            code: "MISSING_TARGET_METADATA",
            message:
              "This automation references an integration target definition that is no longer available. Event metadata may be incomplete.",
          },
          name: "Automation",
          targetName: "Production",
          updatedAt: "2026-03-11T10:05:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    });

    expect(parsed.items[0]?.issue).toEqual({
      code: "MISSING_TARGET_METADATA",
      message:
        "This automation references an integration target definition that is no longer available. Event metadata may be incomplete.",
    });
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
