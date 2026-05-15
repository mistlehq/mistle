import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GitHubPullRequestConversationKeyTemplate } from "./webhook-automation-conversation-key-options.js";
import {
  buildWebhookAutomationEventOptions,
  buildWebhookAutomationSandboxProfileOptions,
  createWebhookAutomationTriggerId,
  resolveEligibleProfileAutomationConnectionIds,
} from "./webhook-automation-option-builders.js";
import type { WebhookAutomationPayloadReference } from "./webhook-automation-trigger-types.js";

const GitHubRepositoryFullNamePayloadReference: WebhookAutomationPayloadReference = {
  path: ["repository", "full_name"],
  description: "Repository owner and name",
};

const GitHubPullRequestNumberPayloadReference: WebhookAutomationPayloadReference = {
  path: ["pull_request", "number"],
  description: "Pull request number",
};

const GitHubConnectionId = "conn_github";
const GitHubWebhookSourceId = "iws_github";
const LinearConnectionId = "conn_linear";
const LinearWebhookSourceId = "iws_linear";
const SlackConnectionId = "conn_slack";
const SlackWebhookSourceId = "iws_slack";

describe("buildWebhookAutomationEventOptions", () => {
  it("returns source-scoped supported webhook events from connected integrations", () => {
    expect(
      buildWebhookAutomationEventOptions({
        connections: [
          {
            id: GitHubConnectionId,
            targetKey: "github-cloud",
            displayName: "GitHub Engineering",
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
          {
            id: LinearConnectionId,
            targetKey: "linear-cloud",
            displayName: "Linear Workspace",
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        webhookSources: [
          {
            id: GitHubWebhookSourceId,
            targetKey: "github-cloud",
            integrationConnectionId: GitHubConnectionId,
            displayName: "GitHub App webhook",
            endpointKey: "ep_github",
            callbackUrl:
              "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_github",
            status: "active",
            providerMetadata: {
              [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
                events: ["issue_comment"],
                permissions: [{ permission: "issues", access: "read" }],
              },
            },
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
          {
            id: LinearWebhookSourceId,
            targetKey: "linear-cloud",
            integrationConnectionId: LinearConnectionId,
            displayName: "Linear Workspace webhook",
            endpointKey: "ep_linear",
            callbackUrl:
              "https://control-plane.example.com/p/integration/webhooks/linear-cloud/ep_linear",
            remoteRegistrationId: "whk_linear",
            status: "active",
            providerMetadata: {},
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        targets: [
          {
            targetKey: "github-cloud",
            familyId: "github",
            variantId: "github-cloud",
            kind: "git",
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
                requirements: {
                  anyOf: [
                    {
                      permissions: [
                        {
                          permission: "issues",
                          access: "read",
                        },
                      ],
                    },
                  ],
                },
                payloadReferences: [GitHubRepositoryFullNamePayloadReference],
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
                payloadReferences: [
                  GitHubRepositoryFullNamePayloadReference,
                  GitHubPullRequestNumberPayloadReference,
                ],
                conversationKeyOptions: [
                  {
                    id: "pull-request",
                    label: "Per pull request",
                    description:
                      "All matching events for the same pull request go to one conversation.",
                    template: GitHubPullRequestConversationKeyTemplate,
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
            variantId: "linear-default",
            kind: "connector",
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
            webhookSourceId: GitHubWebhookSourceId,
            eventType: "github.issue_comment.created",
          }),
        ],
      }),
    ).toEqual([
      {
        availability: "available",
        id: createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
        eventType: "github.issue_comment.created",
        integrationWebhookSourceId: GitHubWebhookSourceId,
        connectionId: GitHubConnectionId,
        connectionLabel: "GitHub - GitHub Engineering",
        label: "Issue comment created",
        requirements: {
          anyOf: [
            {
              permissions: [
                {
                  permission: "issues",
                  access: "read",
                },
              ],
            },
          ],
        },
        payloadReferences: [GitHubRepositoryFullNamePayloadReference],
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
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.pull_request.opened",
        }),
        eventType: "github.pull_request.opened",
        integrationWebhookSourceId: GitHubWebhookSourceId,
        connectionId: GitHubConnectionId,
        connectionLabel: "GitHub - GitHub Engineering",
        label: "Pull request opened",
        payloadReferences: [
          GitHubRepositoryFullNamePayloadReference,
          GitHubPullRequestNumberPayloadReference,
        ],
        conversationKeyOptions: [
          {
            id: "pull-request",
            label: "Per pull request",
            description: "All matching events for the same pull request go to one conversation.",
            template: GitHubPullRequestConversationKeyTemplate,
          },
        ],
        category: "GitHub Engineering / Pull requests",
      },
      {
        availability: "available",
        id: createWebhookAutomationTriggerId({
          webhookSourceId: LinearWebhookSourceId,
          eventType: "linear.issue.created",
        }),
        eventType: "linear.issue.created",
        integrationWebhookSourceId: LinearWebhookSourceId,
        connectionId: LinearConnectionId,
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
            id: GitHubConnectionId,
            targetKey: "github-cloud",
            displayName: "GitHub Engineering",
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        webhookSources: [
          {
            id: GitHubWebhookSourceId,
            targetKey: "github-cloud",
            integrationConnectionId: GitHubConnectionId,
            displayName: "GitHub App webhook",
            endpointKey: "ep_github",
            callbackUrl:
              "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_github",
            status: "active",
            providerMetadata: {},
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        targets: [
          {
            targetKey: "github-cloud",
            familyId: "github",
            variantId: "github-cloud",
            kind: "git",
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
            webhookSourceId: GitHubWebhookSourceId,
            eventType: "github.push.deleted",
          }),
        ],
      }),
    ).toEqual([
      {
        id: createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.push.deleted",
        }),
        eventType: "github.push.deleted",
        integrationWebhookSourceId: GitHubWebhookSourceId,
        connectionId: "",
        connectionLabel: "GitHub - GitHub Engineering",
        label: "github.push.deleted",
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        availability: "missing_integration",
      },
    ]);
  });

  it("filters GitHub triggers whose event or permission requirements are not granted", () => {
    expect(
      buildWebhookAutomationEventOptions({
        connections: [
          {
            id: GitHubConnectionId,
            targetKey: "github-cloud",
            displayName: "GitHub Engineering",
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        webhookSources: [
          {
            id: GitHubWebhookSourceId,
            targetKey: "github-cloud",
            integrationConnectionId: GitHubConnectionId,
            displayName: "GitHub App webhook",
            endpointKey: "ep_github",
            callbackUrl:
              "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_github",
            status: "active",
            providerMetadata: {
              [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
                events: ["issues"],
                permissions: [{ permission: "issues", access: "read" }],
              },
            },
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        targets: [
          {
            targetKey: "github-cloud",
            familyId: "github",
            variantId: "github-cloud",
            kind: "git",
            enabled: true,
            config: {},
            displayName: "GitHub",
            description: "GitHub Cloud",
            supportedWebhookEvents: [
              {
                eventType: "github.issues.opened",
                providerEventType: "issues",
                displayName: "Issue opened",
                requirements: {
                  anyOf: [
                    {
                      event: "issues",
                      permissions: [{ permission: "issues", access: "read" }],
                    },
                  ],
                },
              },
              {
                eventType: "github.pull_request.opened",
                providerEventType: "pull_request",
                displayName: "Pull request opened",
                requirements: {
                  anyOf: [
                    {
                      event: "pull_request",
                      permissions: [{ permission: "pull_requests", access: "read" }],
                    },
                  ],
                },
              },
            ],
            targetHealth: {
              configStatus: "valid",
            },
          },
        ],
        selectedTriggerIds: [],
      }).map((option) => option.eventType),
    ).toEqual(["github.issues.opened"]);
  });

  it("allows Slack message triggers when channel message access is granted", () => {
    expect(
      buildSlackMessageEventTypes({
        events: ["message.channels"],
        permissions: [{ permission: "channels:history" }],
      }),
    ).toEqual(["slack:message"]);
  });

  it("allows Slack message triggers when group message access is granted", () => {
    expect(
      buildSlackMessageEventTypes({
        events: ["message.groups"],
        permissions: [{ permission: "groups:history" }],
      }),
    ).toEqual(["slack:message"]);
  });

  it("hides Slack message triggers when neither message requirement path is granted", () => {
    expect(
      buildSlackMessageEventTypes({
        events: ["app_mention"],
        permissions: [{ permission: "app_mentions:read" }],
      }),
    ).toEqual(["slack:app_mention"]);
  });

  it("requires every permission in the matching Jira trigger requirement set", () => {
    expect(
      buildWebhookAutomationEventOptions({
        connections: [
          {
            id: "conn_jira",
            targetKey: "jira-default",
            displayName: "Jira Product",
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        webhookSources: [
          {
            id: "iws_jira",
            targetKey: "jira-default",
            integrationConnectionId: "conn_jira",
            displayName: "Jira webhook",
            endpointKey: "ep_jira",
            status: "active",
            providerMetadata: {
              [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
                events: ["jira:issue_created"],
                permissions: [{ permission: "read:jira-work" }],
              },
            },
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        targets: [
          {
            targetKey: "jira-default",
            familyId: "jira",
            variantId: "jira-default",
            kind: "connector",
            enabled: true,
            config: {},
            displayName: "Jira",
            description: "Jira Cloud",
            supportedWebhookEvents: [
              {
                eventType: "jira:issue_created",
                providerEventType: "jira:issue_created",
                displayName: "Issue created",
                requirements: {
                  anyOf: [
                    {
                      event: "jira:issue_created",
                      permissions: [
                        { permission: "read:jira-work" },
                        { permission: "manage:jira-webhook" },
                      ],
                    },
                  ],
                },
              },
            ],
            targetHealth: {
              configStatus: "valid",
            },
          },
        ],
        selectedTriggerIds: [],
      }),
    ).toEqual([]);
  });
});

function buildSlackMessageEventTypes(input: {
  events: readonly string[];
  permissions: readonly { permission: string; access?: string }[];
}): readonly string[] {
  return buildWebhookAutomationEventOptions({
    connections: [
      {
        id: SlackConnectionId,
        targetKey: "slack-default",
        displayName: "Slack Engineering",
        status: "active",
        createdAt: "2026-03-16T10:00:00.000Z",
        updatedAt: "2026-03-16T10:00:00.000Z",
      },
    ],
    webhookSources: [
      {
        id: SlackWebhookSourceId,
        targetKey: "slack-default",
        integrationConnectionId: SlackConnectionId,
        displayName: "Slack Events API webhook",
        endpointKey: "ep_slack",
        status: "active",
        providerMetadata: {
          [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
            events: input.events,
            permissions: input.permissions,
          },
        },
        createdAt: "2026-03-16T10:00:00.000Z",
        updatedAt: "2026-03-16T10:00:00.000Z",
      },
    ],
    targets: [
      {
        targetKey: "slack-default",
        familyId: "slack",
        variantId: "slack-default",
        kind: "connector",
        enabled: true,
        config: {},
        displayName: "Slack",
        description: "Slack workspace",
        supportedWebhookEvents: [
          {
            eventType: "slack:message",
            providerEventType: "message",
            displayName: "Message",
            requirements: {
              anyOf: [
                {
                  event: "message.channels",
                  permissions: [{ permission: "channels:history" }],
                },
                {
                  event: "message.groups",
                  permissions: [{ permission: "groups:history" }],
                },
              ],
            },
          },
          {
            eventType: "slack:app_mention",
            providerEventType: "app_mention",
            displayName: "App mention",
            requirements: {
              anyOf: [
                {
                  event: "app_mention",
                  permissions: [{ permission: "app_mentions:read" }],
                },
              ],
            },
          },
        ],
        targetHealth: {
          configStatus: "valid",
        },
      },
    ],
    selectedTriggerIds: [],
  }).map((option) => option.eventType);
}

describe("buildWebhookAutomationSandboxProfileOptions", () => {
  it("does not expose sandbox profile status as option copy", () => {
    expect(
      buildWebhookAutomationSandboxProfileOptions({
        sandboxProfiles: [
          {
            activeVersion: null,
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
            connectionId: GitHubConnectionId,
            kind: "connector",
            config: {},
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
          {
            id: "bnd_linear",
            sandboxProfileId: "sbp_1",
            sandboxProfileVersion: 1,
            connectionId: LinearConnectionId,
            kind: "connector",
            config: {},
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
        ],
        connections: [
          {
            id: GitHubConnectionId,
            targetKey: "github-cloud",
            displayName: "GitHub Engineering",
            status: "active",
            createdAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z",
          },
          {
            id: LinearConnectionId,
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
            kind: "git",
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
            variantId: "linear-default",
            kind: "connector",
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
    ).toEqual([GitHubConnectionId]);
  });
});
