import { describe, expect, it } from "vitest";

import {
  buildWebhookAutomationListItems,
  buildWebhookAutomationEventOptions,
  buildWebhookAutomationSandboxProfileOptions,
  createWebhookAutomationTriggerId,
  formatWebhookAutomationUpdatedAt,
  resolveEligibleProfileAutomationConnectionIds,
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

describe("buildWebhookAutomationListItems", () => {
  it("resolves event labels and logos from integration target metadata", () => {
    expect(
      buildWebhookAutomationListItems({
        automations: [
          {
            id: "atm_1",
            kind: "webhook",
            name: "PR triage",
            enabled: true,
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
            integrationConnectionId: "conn_github",
            eventTypes: ["github.pull_request.opened"],
            payloadFilter: null,
            inputTemplate: "template",
            conversationKeyTemplate: "conversation-key",
            idempotencyKeyTemplate: null,
            target: {
              id: "atg_1",
              sandboxProfileId: "sbp_1",
              sandboxProfileVersion: 1,
            },
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
            logoKey: "github",
            supportedWebhookEvents: [
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
        ],
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
        id: "atm_1",
        name: "PR triage",
        sandboxProfileName: "Repo Maintainer",
        events: [
          {
            label: "Pull request opened",
            logoKey: "github",
          },
        ],
        updatedAtLabel: formatWebhookAutomationUpdatedAt("2026-03-16T10:00:00.000Z"),
        enabled: true,
      },
    ]);
  });

  it("falls back to a target logo for all-events automations", () => {
    expect(
      buildWebhookAutomationListItems({
        automations: [
          {
            id: "atm_2",
            kind: "webhook",
            name: "Everything listener",
            enabled: false,
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
            integrationConnectionId: "conn_github",
            eventTypes: null,
            payloadFilter: null,
            inputTemplate: "template",
            conversationKeyTemplate: "conversation-key",
            idempotencyKeyTemplate: null,
            target: {
              id: "atg_2",
              sandboxProfileId: "sbp_1",
              sandboxProfileVersion: 1,
            },
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
            logoKey: "github",
            supportedWebhookEvents: [],
            targetHealth: {
              configStatus: "valid",
            },
          },
        ],
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
        id: "atm_2",
        name: "Everything listener",
        sandboxProfileName: "Repo Maintainer",
        events: [
          {
            label: "All events",
            logoKey: "github",
          },
        ],
        updatedAtLabel: formatWebhookAutomationUpdatedAt("2026-03-16T10:00:00.000Z"),
        enabled: false,
      },
    ]);
  });

  it("preserves event labels for saved automations on inactive connections", () => {
    expect(
      buildWebhookAutomationListItems({
        automations: [
          {
            id: "atm_3",
            kind: "webhook",
            name: "Inactive connection automation",
            enabled: true,
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
            integrationConnectionId: "conn_github",
            eventTypes: ["github.pull_request.opened"],
            payloadFilter: null,
            inputTemplate: "template",
            conversationKeyTemplate: "conversation-key",
            idempotencyKeyTemplate: null,
            target: {
              id: "atg_3",
              sandboxProfileId: "sbp_1",
              sandboxProfileVersion: 1,
            },
          },
        ],
        connections: [
          {
            id: "conn_github",
            targetKey: "github-cloud",
            displayName: "GitHub Engineering",
            status: "revoked",
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
            logoKey: "github",
            supportedWebhookEvents: [
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
        ],
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
        id: "atm_3",
        name: "Inactive connection automation",
        sandboxProfileName: "Repo Maintainer",
        events: [
          {
            label: "Pull request opened",
            logoKey: "github",
          },
        ],
        updatedAtLabel: formatWebhookAutomationUpdatedAt("2026-03-16T10:00:00.000Z"),
        enabled: true,
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
