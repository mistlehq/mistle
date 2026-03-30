import { describe, expect, it } from "vitest";

import {
  buildWebhookAutomationEventOptions,
  buildWebhookAutomationSandboxProfileOptions,
  createWebhookAutomationTriggerId,
  resolveEligibleProfileAutomationConnectionIds,
} from "./webhook-automation-option-builders.js";

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
        availability: "available",
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
        availability: "available",
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
        availability: "available",
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
        connectionLabel: "GitHub - GitHub Engineering",
        label: "github.push.deleted",
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        availability: "missing_integration",
      },
    ]);
  });

  it("preserves selected triggers that are incompatible with the selected profile", () => {
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
            supportedWebhookEvents: [
              {
                eventType: "github.issue_comment.created",
                providerEventType: "issue_comment",
                displayName: "Issue comment created",
              },
            ],
            targetHealth: {
              configStatus: "valid",
            },
          },
        ],
        selectableConnectionIds: [],
        selectedTriggerIds: [
          createWebhookAutomationTriggerId({
            connectionId: "conn_github",
            eventType: "github.issue_comment.created",
          }),
        ],
      }),
    ).toEqual([
      {
        id: createWebhookAutomationTriggerId({
          connectionId: "conn_github",
          eventType: "github.issue_comment.created",
        }),
        eventType: "github.issue_comment.created",
        connectionId: "conn_github",
        connectionLabel: "GitHub - GitHub Engineering",
        label: "Issue comment created",
        description: "Trigger is unavailable for the selected sandbox profile.",
        category: "Unavailable",
        availability: "wrong_profile",
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
});

describe("resolveEligibleProfileAutomationConnectionIds", () => {
  it("returns bound connection ids whose targets expose automation triggers", () => {
    expect(
      resolveEligibleProfileAutomationConnectionIds({
        bindings: [
          {
            id: "bnd_github",
            sandboxProfileId: "sbp_1",
            sandboxProfileVersion: 1,
            connectionId: "conn_github",
            kind: "connector",
            config: {},
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
          {
            id: "bnd_linear",
            sandboxProfileId: "sbp_1",
            sandboxProfileVersion: 1,
            connectionId: "conn_linear",
            kind: "connector",
            config: {},
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
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
            supportedWebhookEvents: [],
            targetHealth: {
              configStatus: "valid",
            },
          },
        ],
      }),
    ).toEqual(["conn_github"]);
  });
});
