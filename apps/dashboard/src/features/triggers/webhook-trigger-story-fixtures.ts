import { QueryClient } from "@tanstack/react-query";

import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import type { WebhookTriggerEventOption } from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";
import { createWebhookTriggerEventId } from "./webhook-trigger-option-builders.js";
import { createGitHubEventOption } from "./webhook-trigger-test-fixtures.js";

export const StoryGitHubConnectionId = "conn_github_prod";
export const StoryGitHubWebhookSourceId = "iws_github_prod";
export const StorySlackConnectionId = "conn_slack_prod";
export const StorySlackWebhookSourceId = "iws_slack_prod";

export function isRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS,
    value,
  };
}

export function isNotRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS_NOT,
    value,
  };
}

export function containsTokenRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
    value,
  };
}

export const StoryIssueCommentCreatedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.issue_comment.created",
});
export const StoryPullRequestOpenedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.pull_request.opened",
});
export const StoryPullRequestReviewRequestedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.pull_request.review_requested",
});
export const StoryPullRequestReviewCommentCreatedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.pull_request_review_comment.created",
});
export const StoryPullRequestReviewSubmittedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.pull_request_review.submitted",
});
export const StoryPushDeletedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StoryGitHubWebhookSourceId,
  eventType: "github.push.deleted",
});
export const StorySlackAppMentionTriggerId = createWebhookTriggerEventId({
  webhookSourceId: StorySlackWebhookSourceId,
  eventType: "slack:app_mention",
});

const StoryGitHubRepositoryResources: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
  familyId: "github",
  kind: "repository",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_repo_1",
      familyId: "github",
      kind: "repository",
      externalId: "repo_1",
      handle: "mistlehq/platform",
      displayName: "mistlehq/platform",
      status: "accessible",
      metadata: {},
    },
    {
      id: "icr_github_repo_2",
      familyId: "github",
      kind: "repository",
      externalId: "repo_2",
      handle: "mistlehq/dashboard",
      displayName: "mistlehq/dashboard",
      status: "accessible",
      metadata: {},
    },
  ],
};

const StoryGitHubBranchResources: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
  familyId: "github",
  kind: "branch",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_branch_1",
      familyId: "github",
      kind: "branch",
      externalId: "repo_1:main",
      handle: "main",
      displayName: "main",
      status: "accessible",
      metadata: {
        repositoryFullName: "mistlehq/platform",
      },
    },
    {
      id: "icr_github_branch_2",
      familyId: "github",
      kind: "branch",
      externalId: "repo_1:release",
      handle: "release",
      displayName: "release",
      status: "accessible",
      metadata: {
        repositoryFullName: "mistlehq/platform",
      },
    },
  ],
};

const StoryGitHubUserResources: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
  familyId: "github",
  kind: "user",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_user_1",
      familyId: "github",
      kind: "user",
      externalId: "1001",
      handle: "octocat",
      displayName: "octocat",
      status: "accessible",
      metadata: {},
    },
    {
      id: "icr_github_user_2",
      familyId: "github",
      kind: "user",
      externalId: "1002",
      handle: "hubot",
      displayName: "hubot",
      status: "accessible",
      metadata: {},
    },
  ],
};

const StoryGitHubTeamResources: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
  familyId: "github",
  kind: "team",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_github_team_1",
      familyId: "github",
      kind: "team",
      handle: "platform",
      displayName: "Platform (mistlehq)",
      status: "accessible",
      metadata: {
        organizationLogins: ["mistlehq"],
      },
    },
    {
      id: "icr_github_team_2",
      familyId: "github",
      kind: "team",
      handle: "security",
      displayName: "Security (mistlehq)",
      status: "accessible",
      metadata: {
        organizationLogins: ["mistlehq"],
      },
    },
  ],
};

export const StoryGitHubTeamResourcesSyncFailed: IntegrationConnectionResources = {
  connectionId: StoryGitHubConnectionId,
  familyId: "github",
  kind: "team",
  syncState: "error",
  lastErrorMessage:
    "GitHub returned 403 while listing teams. Reapprove Members read permission for this installation.",
  items: [],
};

const StorySlackChannelResources: IntegrationConnectionResources = {
  connectionId: StorySlackConnectionId,
  familyId: "slack",
  kind: "channel",
  syncState: "ready",
  lastSyncedAt: "2026-03-17T00:00:00.000Z",
  items: [
    {
      id: "icr_slack_channel_1",
      familyId: "slack",
      kind: "channel",
      externalId: "C_ALERTS_001",
      handle: "C_ALERTS_001",
      displayName: "#alerts",
      status: "accessible",
      metadata: {},
    },
    {
      id: "icr_slack_channel_2",
      familyId: "slack",
      kind: "channel",
      externalId: "C_ENG_001",
      handle: "C_ENG_001",
      displayName: "#engineering",
      status: "accessible",
      metadata: {},
    },
  ],
};

export const StoryGitHubEventOptions: readonly WebhookTriggerEventOption[] = [
  createGitHubEventOption({
    eventType: "github.issue_comment.created",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryIssueCommentCreatedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.issues.opened",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
  }),
  createGitHubEventOption({
    eventType: "github.pull_request.opened",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryPullRequestOpenedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request.review_requested",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryPullRequestReviewRequestedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request_review.submitted",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryPullRequestReviewSubmittedTriggerId },
  }),
  createGitHubEventOption({
    eventType: "github.pull_request_review_comment.created",
    connectionId: StoryGitHubConnectionId,
    webhookSourceId: StoryGitHubWebhookSourceId,
    connectionLabel: "GitHub Engineering",
    categoryPrefix: "GitHub Engineering",
    overrides: { id: StoryPullRequestReviewCommentCreatedTriggerId },
  }),
];

export const StorySlackEventOptions: readonly WebhookTriggerEventOption[] = [
  {
    id: StorySlackAppMentionTriggerId,
    eventType: "slack:app_mention",
    integrationWebhookSourceId: StorySlackWebhookSourceId,
    connectionId: StorySlackConnectionId,
    connectionLabel: "Slack Engineering",
    label: "App mention",
    category: "Slack Engineering / Messages",
    logoKey: "slack",
    parameters: [
      {
        id: "channel",
        label: "channel",
        kind: "resource-select",
        resourceKind: "channel",
        payloadPath: ["event", "channel"],
        prefix: "in",
      },
    ],
  },
];

export function createWebhookTriggerStoryQueryClient(input?: {
  githubTeamResources?: IntegrationConnectionResources;
}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(
    ["trigger-trigger-parameters", StoryGitHubConnectionId, "repository"],
    StoryGitHubRepositoryResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StoryGitHubConnectionId, "branch"],
    StoryGitHubBranchResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StoryGitHubConnectionId, "user"],
    StoryGitHubUserResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StoryGitHubConnectionId, "team"],
    input?.githubTeamResources ?? StoryGitHubTeamResources,
  );
  queryClient.setQueryData(
    ["trigger-trigger-parameters", StorySlackConnectionId, "channel"],
    StorySlackChannelResources,
  );

  return queryClient;
}
