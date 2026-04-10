import { describe, expect, it } from "vitest";

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
            providerMetadata: {},
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
            template:
              "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
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
    ).toEqual([GitHubConnectionId]);
  });
});
