import { describe, expect, it } from "vitest";

import {
  buildWebhookAutomationEventOptions,
  buildWebhookAutomationListItems,
  buildWebhookAutomationSandboxProfileOptions,
  createWebhookAutomationTriggerId,
} from "./webhook-automation-list-helpers.js";

describe("buildWebhookAutomationEventOptions", () => {
  it("returns connection-scoped supported webhook events from all connected integrations", () => {
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
                conversationKeyOptions: [
                  {
                    id: "issue",
                    label: "Per issue thread",
                    description: "All matching events for the same issue go to one conversation.",
                    template: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
                  },
                ],
              },
              {
                eventType: "github.pull_request.opened",
                providerEventType: "pull_request",
                displayName: "Pull request opened",
                category: "Pull requests",
                conversationKeyOptions: [
                  {
                    id: "pull-request",
                    label: "Per pull request",
                    description:
                      "All matching events for the same pull request go to one conversation.",
                    template:
                      "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
                  },
                ],
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
        selectedTriggerIds: [
          createWebhookAutomationTriggerId({
            connectionId: "conn_github",
            eventType: "github.pull_request.opened",
          }),
        ],
      }),
    ).toEqual([
      {
        id: createWebhookAutomationTriggerId({
          connectionId: "conn_github",
          eventType: "github.pull_request.opened",
        }),
        eventType: "github.pull_request.opened",
        connectionId: "conn_github",
        connectionLabel: "GitHub - GitHub Engineering",
        label: "Pull request opened",
        conversationKeyOptions: [
          {
            id: "pull-request",
            label: "Per pull request",
            description: "All matching events for the same pull request go to one conversation.",
            template:
              "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
          },
        ],
        category: "GitHub Engineering / Pull requests",
      },
      {
        id: createWebhookAutomationTriggerId({
          connectionId: "conn_github",
          eventType: "github.issue_comment.created",
        }),
        eventType: "github.issue_comment.created",
        connectionId: "conn_github",
        connectionLabel: "GitHub - GitHub Engineering",
        label: "Issue comment created",
        conversationKeyOptions: [
          {
            id: "issue",
            label: "Per issue thread",
            description: "All matching events for the same issue go to one conversation.",
            template: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
          },
        ],
        category: "GitHub Engineering / Issues",
      },
      {
        id: createWebhookAutomationTriggerId({
          connectionId: "conn_linear",
          eventType: "linear.issue.created",
        }),
        eventType: "linear.issue.created",
        connectionId: "conn_linear",
        connectionLabel: "Linear - Linear Workspace",
        label: "Issue created",
        category: "Linear Workspace / Issues",
        logoKey: "linear",
      },
    ]);
  });

  it("preserves selected triggers that are no longer advertised by connected integrations", () => {
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
        selectedTriggerIds: [
          createWebhookAutomationTriggerId({
            connectionId: "conn_github",
            eventType: "github.push.deleted",
          }),
        ],
      }),
    ).toEqual([
      {
        id: createWebhookAutomationTriggerId({
          connectionId: "conn_github",
          eventType: "github.push.deleted",
        }),
        eventType: "github.push.deleted",
        connectionId: "conn_github",
        connectionLabel: "conn_github",
        label: "github.push.deleted",
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        unavailable: true,
      },
    ]);
  });
});

describe("buildWebhookAutomationSandboxProfileOptions", () => {
  it("does not expose sandbox profile status as option copy", () => {
    expect(
      buildWebhookAutomationSandboxProfileOptions({
        sandboxProfiles: [
          {
            id: "sbp_1",
            organizationId: "org_1",
            displayName: "Repo Maintainer",
            eligibleIntegrationConnectionIds: [],
            latestVersion: 1,
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        value: "sbp_1",
        label: "Repo Maintainer",
      },
    ]);
  });

  it("preserves the current profile when it is no longer automation-applicable", () => {
    expect(
      buildWebhookAutomationSandboxProfileOptions({
        sandboxProfiles: [
          {
            id: "sbp_1",
            organizationId: "org_1",
            displayName: "Repo Maintainer",
            eligibleIntegrationConnectionIds: [],
            latestVersion: 1,
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        preservedProfile: {
          id: "sbp_stale",
          displayName: "Legacy Agent",
        },
      }),
    ).toEqual([
      {
        value: "sbp_stale",
        label: "Legacy Agent",
        description: "No longer applicable for webhook-triggered automations.",
      },
      {
        value: "sbp_1",
        label: "Repo Maintainer",
      },
    ]);
  });
});

describe("buildWebhookAutomationListItems", () => {
  it("prefers the saved sandbox profile display name when the current profile lookup misses", () => {
    expect(
      buildWebhookAutomationListItems({
        automations: [
          {
            conversationKeyTemplate: "{{event.id}}",
            createdAt: "2026-03-11T10:00:00.000Z",
            enabled: true,
            eventTypes: ["github.push"],
            id: "aut_123",
            idempotencyKeyTemplate: null,
            inputTemplate: "{}",
            integrationConnectionId: "conn_123",
            kind: "webhook",
            name: "Automation",
            payloadFilter: null,
            target: {
              id: "target_123",
              sandboxProfileId: "sbp_stale",
              sandboxProfileDisplayName: "Legacy Agent",
              sandboxProfileVersion: null,
            },
            updatedAt: "2026-03-11T10:05:00.000Z",
          },
        ],
        connections: [],
        sandboxProfiles: [],
      }),
    ).toMatchObject([
      {
        sandboxProfileName: "Legacy Agent",
      },
    ]);
  });
});
