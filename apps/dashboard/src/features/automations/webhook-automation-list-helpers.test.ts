import { describe, expect, it } from "vitest";

import { buildWebhookAutomationEventOptions } from "./webhook-automation-list-helpers.js";

describe("buildWebhookAutomationEventOptions", () => {
  it("returns supported webhook events from all connected integrations", () => {
    expect(
      buildWebhookAutomationEventOptions({
        connections: [
          {
            id: "conn_github",
            targetKey: "github-cloud",
            displayName: "GitHub Engineering",
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
          {
            id: "conn_linear",
            targetKey: "linear-cloud",
            displayName: "Linear Workspace",
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        targets: [
          {
            targetKey: "github-cloud",
            familyId: "github",
            variantId: "github-cloud",
            enabled: true,
            config: {},
            displayName: "GitHub",
            description: "GitHub Cloud",
            supportedWebhookEvents: [
              {
                eventType: "github.issue_comment.created",
                providerEventType: "issue_comment",
                displayName: "Issue comment created",
                category: "Issues",
              },
              {
                eventType: "github.pull_request.opened",
                providerEventType: "pull_request",
                displayName: "Pull request opened",
                category: "Pull requests",
              },
            ],
            targetHealth: {
              configStatus: "valid",
            },
          },
          {
            targetKey: "linear-cloud",
            familyId: "linear",
            variantId: "linear-cloud",
            enabled: true,
            config: {},
            displayName: "Linear",
            description: "Linear Cloud",
            logoKey: "linear",
            supportedWebhookEvents: [
              {
                eventType: "linear.issue.created",
                providerEventType: "Issue",
                displayName: "Issue created",
                category: "Issues",
              },
            ],
            targetHealth: {
              configStatus: "valid",
            },
          },
        ],
        selectedEventTypes: ["github.pull_request.opened"],
      }),
    ).toEqual([
      {
        value: "github.pull_request.opened",
        label: "Pull request opened",
        category: "Pull requests",
      },
      {
        value: "github.issue_comment.created",
        label: "Issue comment created",
        category: "Issues",
      },
      {
        value: "linear.issue.created",
        label: "Issue created",
        category: "Issues",
        logoKey: "linear",
      },
    ]);
  });

  it("preserves selected event types that are no longer advertised by connected integrations", () => {
    expect(
      buildWebhookAutomationEventOptions({
        connections: [
          {
            id: "conn_github",
            targetKey: "github-cloud",
            displayName: "GitHub Engineering",
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        targets: [
          {
            targetKey: "github-cloud",
            familyId: "github",
            variantId: "github-cloud",
            enabled: true,
            config: {},
            displayName: "GitHub",
            description: "GitHub Cloud",
            supportedWebhookEvents: [],
            targetHealth: {
              configStatus: "valid",
            },
          },
        ],
        selectedEventTypes: ["github.push.deleted"],
      }),
    ).toEqual([
      {
        value: "github.push.deleted",
        label: "github.push.deleted",
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        unavailable: true,
      },
    ]);
  });
});
